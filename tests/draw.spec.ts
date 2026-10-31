// 求签流程测试（add-ton-chain-support 3.5）：
// 8 MERIT 消耗、来源验证（仅接受 Jetton Master 派生的用户钱包）、query_id 登记、
// NFT 铸造命令、伪造 sender/金额不足/重复 query 拒绝。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { IncenseDraw, storeResumeDraw, storeTokenTransferInternal } from '../output/CaishenBusiness_IncenseDraw';
import { JettonMaster, storeMint, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';
import { NftCollection, storeSetNftMinter } from '../output/CaishenNft_NftCollection';
import { NftItem } from '../output/CaishenNft_NftItem';

const DECIMALS = 9n;
const MERIT = (n: bigint) => n * 10n ** DECIMALS;
const MERIT8 = MERIT(8n);

function drawPayload(queryId: bigint) {
  return beginCell().storeUint(queryId, 64).endCell().asSlice();
}

describe('求签流程', () => {
  async function deploy() {
    const blockchain = await Blockchain.create();
    blockchain.now = Math.floor(Date.now() / 1000);
    const admin = await blockchain.treasury('admin');
    const user = await blockchain.treasury('user');
    const outsider = await blockchain.treasury('outsider');

    // JettonMaster（minter 后置登记）→ business → collection（minter=business）
    const jettonMaster: SandboxContract<JettonMaster> = blockchain.openContract(
      await JettonMaster.fromInit(admin.address, beginCell().endCell(), MERIT(1000000n), DECIMALS),
    );
    const nftCollection: SandboxContract<NftCollection> = blockchain.openContract(
      await NftCollection.fromInit(admin.address, beginCell().endCell()),
    );
    const businessFinal: SandboxContract<IncenseDraw> = blockchain.openContract(
      await IncenseDraw.fromInit(
        admin.address,
        jettonMaster.address,
        nftCollection.address,
        DECIMALS,
        BigInt(blockchain.now - 86400),
        2n,
        MERIT(200n),
        toNano('0.1'),
      ),
    );

    await admin.send({ to: jettonMaster.address, value: toNano('0.05'), init: jettonMaster.init });
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetMinter({ $$type: 'SetMinter' as const, minter: businessFinal.address })).endCell(),
    });
    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
    await admin.send({
      to: nftCollection.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: businessFinal.address })).endCell(),
    });
    await admin.send({ to: businessFinal.address, value: toNano('0.2'), init: businessFinal.init });
    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });

    // admin 铸 8 MERIT 给 user（master owner 授权路径）
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.2'),
      body: beginCell().store(storeMint({ $$type: 'Mint' as const, queryId: 999n, receiver: user.address, amount: MERIT(24n) })).endCell(),
    });

    const userWallet = blockchain.openContract(await JettonWallet.fromInit(user.address, jettonMaster.address));
    expect((await userWallet.getGetWalletData()).balance).toBe(MERIT(24n));

    async function draw(from: SandboxContract<TreasuryContract>, wallet: SandboxContract<JettonWallet>, queryId: bigint, amount: bigint) {
      return wallet.send(from.getSender(), {
        value: toNano('0.2'),
      }, {
        $$type: 'TokenTransfer' as const,
        queryId,
        amount,
        destination: businessFinal.address,
        responseDestination: from.address,
        forwardTonAmount: toNano('0.05'),
        forwardPayload: drawPayload(queryId),
      });
    }

    return { blockchain, admin, user, outsider, jettonMaster, business: businessFinal, nftCollection, userWallet, draw };
  }

  test('正常求签：8 MERIT 消耗、登记与 NFT 铸给求签者', async () => {
    const { blockchain, user, business, nftCollection, userWallet, draw } = await deploy();

    const result = await draw(user, userWallet, 1n, MERIT8);

    // 求签链：user wallet → business → collection → item 部署
    expect(result.transactions).toHaveTransaction({ to: business.address, success: true });
    expect(result.transactions).toHaveTransaction({ to: nftCollection.address, success: true });
    expect(result.transactions).toHaveTransaction({ endStatus: 'active', success: true });
    expect(result.transactions).toHaveTransaction({ from: nftCollection.address, to: business.address, success: true });

    const request = await business.getDrawRequest(1n);
    expect(request !== null).toBe(true);
    expect(request!!).toHaveProperty('requester');
    expect((request as any).requester.equals(user.address)).toBe(true);
    expect((request as any).itemIndex).toBe(0n);
    expect((request as any).state).toBe(1n);

    expect(await business.getDrawTreasury()).toBe(MERIT8);
    expect(await business.getDrawCount()).toBe(1n);

    const item = blockchain.openContract(await NftItem.fromInit(nftCollection.address, 0n));
    const nftData = await item.getGetNftData();
    expect(nftData.owner.equals(user.address)).toBe(true);
    expect(nftData.index).toBe(0n);
  });

  test('伪造来源（sender 非派生钱包）被拒绝', async () => {
    const { outsider, business, draw } = await deploy();

    // outsider 直接伪造 TokenTransferInternal（自报 from=user）——但其地址不是
    // user 的派生钱包，business 必须拒绝
    const fakeBody = beginCell()
      .store(
        storeTokenTransferInternal({
          $$type: 'TokenTransferInternal' as const,
          queryId: 2n,
          amount: MERIT8,
          from: outsider.address, // 自报来源
          responseAddress: null,
          forwardTonAmount: toNano('0.05'),
          forwardPayload: drawPayload(2n),
        }),
      )
      .endCell();
    const result = await outsider.send({ to: business.address, value: toNano('0.3'), body: fakeBody });

    expect(result.transactions).toHaveTransaction({ to: business.address, success: false });
    expect(await business.getDrawCount()).toBe(0n);
    expect(await business.getDrawTreasury()).toBe(0n);
  });

  test('金额不足 8 MERIT 被拒绝', async () => {
    const { user, business, userWallet, draw } = await deploy();

    const result = await draw(user, userWallet, 3n, MERIT8 - 1n);
    expect(result.transactions).toHaveTransaction({ to: business.address, success: false });
    expect(await business.getDrawCount()).toBe(0n);
  });

  test('重复 query_id 被拒', async () => {
    const { user, business, userWallet, draw } = await deploy();

    await draw(user, userWallet, 4n, MERIT8);
    const dup = await draw(user, userWallet, 4n, MERIT8);
    expect(dup.transactions).toHaveTransaction({ to: business.address, success: false });
    expect(await business.getDrawCount()).toBe(1n);
  });

  test('drawCost 暴露 8 MERIT', async () => {
    const { business } = await deploy();
    expect(await business.getDrawCost()).toBe(MERIT8);
  });
});

// ===== 3.6：resume_draw 恢复 =====

describe('求签恢复 resume_draw', () => {
  // 「消耗后铸造中断」的忠实构造：collection 未部署时求签（MintNFT 发往未部署
  // 地址被丢弃，bounce: false），state 停在 0——对应真实世界的索引/部署失败形态；
  // 之后补部署 collection，resume 触发重发铸造命令。
  async function deployWithPendingDraw() {
    const blockchain = await Blockchain.create();
    blockchain.now = Math.floor(Date.now() / 1000);
    const admin = await blockchain.treasury('admin');
    const user = await blockchain.treasury('user');
    const outsider = await blockchain.treasury('outsider');

    const jettonMaster: SandboxContract<JettonMaster> = blockchain.openContract(
      await JettonMaster.fromInit(admin.address, beginCell().endCell(), MERIT(1000000n), DECIMALS),
    );
    const nftCollection: SandboxContract<NftCollection> = blockchain.openContract(
      await NftCollection.fromInit(admin.address, beginCell().endCell()),
    );
    const business: SandboxContract<IncenseDraw> = blockchain.openContract(
      await IncenseDraw.fromInit(
        admin.address,
        jettonMaster.address,
        nftCollection.address,
        DECIMALS,
        BigInt(blockchain.now - 86400),
        2n,
        MERIT(200n),
        toNano('0.1'),
      ),
    );

    await admin.send({ to: jettonMaster.address, value: toNano('0.05'), init: jettonMaster.init });
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetMinter({ $$type: 'SetMinter' as const, minter: business.address })).endCell(),
    });
    await admin.send({ to: business.address, value: toNano('0.3'), init: business.init });

    // admin 铸 MERIT 给 user（够一次求签；恢复不重复扣费）
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.2'),
      body: beginCell().store(storeMint({ $$type: 'Mint' as const, queryId: 999n, receiver: user.address, amount: MERIT8 })).endCell(),
    });

    const userWallet = blockchain.openContract(await JettonWallet.fromInit(user.address, jettonMaster.address));

    // 求签（collection 尚未部署）：消耗登记成功，铸造命令发往未部署地址被丢弃
    await userWallet.send(user.getSender(), { value: toNano('0.2') }, {
      $$type: 'TokenTransfer' as const,
      queryId: 50n,
      amount: MERIT8,
      destination: business.address,
      responseDestination: user.address,
      forwardTonAmount: toNano('0.05'),
      forwardPayload: drawPayload(50n),
    });

    const request = await business.getDrawRequest(50n);
    expect(request !== null).toBe(true);
    expect((request as any).state).toBe(0n); // 消耗已登记，铸造未确认

    return { blockchain, admin, user, outsider, jettonMaster, business, nftCollection, userWallet };
  }

  test('消耗后铸造中断：resume 部署 collection 后恢复且不重复扣费', async () => {
    const deployed = await deployWithPendingDraw();
    const { blockchain, admin, user, business, nftCollection } = deployed;

    // 补部署 collection 并登记 minter
    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
    await admin.send({
      to: nftCollection.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: business.address })).endCell(),
    });

    const meritBefore = await (blockchain.openContract(await JettonWallet.fromInit(user.address, (await business.getContractConfig()).jettonMaster))).getGetWalletData();

    const resume = await user.send({
      to: business.address,
      value: toNano('0.2'),
      body: beginCell().store(storeResumeDraw({ $$type: 'ResumeDraw' as const, queryId: 50n })).endCell(),
    });
    expect(resume.transactions).toHaveTransaction({ to: business.address, success: true });
    expect(resume.transactions).toHaveTransaction({ to: nftCollection.address, success: true });

    // item 铸出、状态推进、MERIT 不再扣（drawTreasury 仍 8 MERIT）
    const item = blockchain.openContract(await NftItem.fromInit(nftCollection.address, 0n));
    expect((await item.getGetNftData()).owner.equals(user.address)).toBe(true);
    expect((await business.getDrawRequest(50n) as any).state).toBe(1n);
    expect(await business.getDrawTreasury()).toBe(MERIT8);
    const meritAfter = await (blockchain.openContract(await JettonWallet.fromInit(user.address, (await business.getContractConfig()).jettonMaster))).getGetWalletData();
    expect(meritAfter.balance).toBe(meritBefore.balance);

    // 签号范围 1–60
    const stickNo = await item.getGetStickNo();
    expect(stickNo).toBeGreaterThanOrEqual(1n);
    expect(stickNo).toBeLessThanOrEqual(60n);
  });

  test('重复恢复至多一枚 NFT（状态已铸 + Collection 幂等双保险）', async () => {
    const { blockchain, admin, user, business, nftCollection, userWallet } = { ...(await deployWithPendingDraw()) };

    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
    await admin.send({
      to: nftCollection.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: business.address })).endCell(),
    });

    // 第一次恢复：铸造完成
    const first = await user.send({
      to: business.address,
      value: toNano('0.2'),
      body: beginCell().store(storeResumeDraw({ $$type: 'ResumeDraw' as const, queryId: 50n })).endCell(),
    });
    expect(first.transactions).toHaveTransaction({ to: nftCollection.address, success: true });

    // 第二次恢复：state 已铸，business 拒绝
    const second = await user.send({
      to: business.address,
      value: toNano('0.2'),
      body: beginCell().store(storeResumeDraw({ $$type: 'ResumeDraw' as const, queryId: 50n })).endCell(),
    });
    expect(second.transactions).toHaveTransaction({ to: business.address, success: false });

    // 至多一枚 NFT（index 0 是唯一 item）
    expect(await business.getDrawCount()).toBe(1n);
    const item = blockchain.openContract(await NftItem.fromInit(nftCollection.address, 0n));
    expect((await item.getGetNftData()).owner.equals(user.address)).toBe(true);
  });

  test('非请求者不可冒领恢复', async () => {
    const { admin, outsider, user, business, nftCollection } = { ...(await deployWithPendingDraw()) };

    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
    await admin.send({
      to: nftCollection.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: business.address })).endCell(),
    });

    const resume = await outsider.send({
      to: business.address,
      value: toNano('0.2'),
      body: beginCell().store(storeResumeDraw({ $$type: 'ResumeDraw' as const, queryId: 50n })).endCell(),
    });
    expect(resume.transactions).toHaveTransaction({ to: business.address, success: false });
    expect((await business.getDrawRequest(50n) as any).state).toBe(0n);
  });
});

// 求签流程测试（add-ton-chain-support 3.5）：
// 8 MERIT 消耗、来源验证（仅接受 Jetton Master 派生的用户钱包）、query_id 登记、
// NFT 铸造命令、伪造 sender/金额不足/重复 query 拒绝。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { IncenseDraw, storeTokenTransferInternal } from '../output/CaishenBusiness_IncenseDraw';
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

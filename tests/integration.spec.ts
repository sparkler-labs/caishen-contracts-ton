// 完整消息流集成测试与 gas 预算（add-ton-chain-support 3.7）：
// 全链流程（多用户上香 → 求签 → NFT → 转移）、付款成功但下游失败不产生伪成功、
// bounce 回滚不丢 MERIT、消息乱序（resume 先于求签）、gas 预算上限。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { IncenseDraw, storeIncensePayment, storeResumeDraw } from '../output/CaishenBusiness_IncenseDraw';
import { JettonMaster, storeMint, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';
import { NftCollection, storeSetNftMinter } from '../output/CaishenNft_NftCollection';
import { NftItem } from '../output/CaishenNft_NftItem';

const DECIMALS = 9n;
const MERIT = (n: bigint) => n * 10n ** DECIMALS;
const MERIT8 = MERIT(8n);
const MINT_PRICE = toNano('0.1');

function drawPayload(queryId: bigint) {
  return beginCell().storeUint(queryId, 64).endCell().asSlice();
}

function incenseBody(queryId: bigint) {
  return beginCell()
    .store(storeIncensePayment({ $$type: 'IncensePayment' as const, queryId }))
    .endCell();
}

describe('完整消息流集成', () => {
  async function deploy(maxMasterSupply: bigint = MERIT(1000000n)) {
    const blockchain = await Blockchain.create();
    blockchain.now = Math.floor(Date.now() / 1000);
    const admin = await blockchain.treasury('admin');
    const u1 = await blockchain.treasury('u1');
    const u2 = await blockchain.treasury('u2');
    const u3 = await blockchain.treasury('u3');

    const jettonMaster: SandboxContract<JettonMaster> = blockchain.openContract(
      await JettonMaster.fromInit(admin.address, beginCell().endCell(), maxMasterSupply, DECIMALS),
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
        MERIT(10000n), // 大日供应：集成流不触每日耗尽
        MINT_PRICE,
      ),
    );

    await admin.send({ to: jettonMaster.address, value: toNano('0.05'), init: jettonMaster.init });
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetMinter({ $$type: 'SetMinter' as const, minter: business.address })).endCell(),
    });
    await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
    await admin.send({
      to: nftCollection.address,
      value: toNano('0.05'),
      body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: business.address })).endCell(),
    });
    await admin.send({ to: business.address, value: toNano('1'), init: business.init });

    async function seedMerit(user: SandboxContract<TreasuryContract>, amount: bigint, queryId: bigint) {
      await admin.send({
        to: jettonMaster.address,
        value: toNano('0.2'),
        body: beginCell().store(storeMint({ $$type: 'Mint' as const, queryId, receiver: user.address, amount })).endCell(),
      });
    }

    return { blockchain, admin, u1, u2, u3, jettonMaster, nftCollection, business, seedMerit };
  }

  async function walletOf(blockchain: Blockchain, jettonMaster: SandboxContract<JettonMaster>, owner: SandboxContract<TreasuryContract>) {
    return blockchain.openContract(await JettonWallet.fromInit(owner.address, jettonMaster.address));
  }

  test('全链流程：多用户上香 → 求签 → NFT 转移', async () => {
    const { blockchain, u1, u2, u3, jettonMaster, nftCollection, business } = await deploy();

    // 上香：三位用户按全局序列 88/66/36 获得 MERIT
    const r1 = await u1.send({ to: business.address, value: MINT_PRICE + toNano('0.2'), body: incenseBody(101n) });
    const r2 = await u2.send({ to: business.address, value: MINT_PRICE + toNano('0.2'), body: incenseBody(102n) });
    const r3 = await u3.send({ to: business.address, value: MINT_PRICE + toNano('0.2'), body: incenseBody(103n) });
    expect(r1.transactions).toHaveTransaction({ to: business.address, success: true });
    expect(r2.transactions).toHaveTransaction({ to: business.address, success: true });
    expect(r3.transactions).toHaveTransaction({ to: business.address, success: true });

    const w1 = await walletOf(blockchain, jettonMaster, u1);
    const w2 = await walletOf(blockchain, jettonMaster, u2);
    const w3 = await walletOf(blockchain, jettonMaster, u3);
    expect((await w1.getGetWalletData()).balance).toBe(MERIT(88n));
    expect((await w2.getGetWalletData()).balance).toBe(MERIT(66n));
    expect((await w3.getGetWalletData()).balance).toBe(MERIT(36n));

    // 求签：u1 消耗 8 MERIT，NFT 铸出且签号在 1–60
    const draw = await w1.send(u1.getSender(), { value: toNano('0.2') }, {
      $$type: 'TokenTransfer' as const,
      queryId: 200n,
      amount: MERIT8,
      destination: business.address,
      responseDestination: u1.address,
      forwardTonAmount: toNano('0.05'),
      forwardPayload: drawPayload(200n),
    });
    expect(draw.transactions).toHaveTransaction({ to: business.address, success: true });

    const item0 = blockchain.openContract(await NftItem.fromInit(nftCollection.address, 0n));
    expect((await item0.getGetNftData()).owner.equals(u1.address)).toBe(true);
    const stickNo = await item0.getGetStickNo();
    expect(stickNo).toBeGreaterThanOrEqual(1n);
    expect(stickNo).toBeLessThanOrEqual(60n);

    // 标准转移：u1 → u2（当前所有者更新、collection index 不回退）
    await item0.send(u1.getSender(), { value: toNano('0.1') }, {
      $$type: 'NFTTransfer' as const,
      queryId: 201n,
      newOwner: u2.address,
      responseDestination: u1.address,
      forwardAmount: 0n,
      forwardPayload: beginCell().endCell().asSlice(),
    });
    expect((await item0.getGetNftData()).owner.equals(u2.address)).toBe(true);
    expect((await nftCollection.getGetCollectionData()).nextItemIndex).toBe(1n);
  });

  test('付款成功但下游失败：不产生伪成功资产与状态', async () => {
    // 下游失败构造：master maxSupply 只够一次 88 MERIT——第二次上香时
    // business 规则通过（付款方成功）但 master mint 被 maxSupply 拒绝，
    // 付款人收不到 MERIT——失败路径不得产生任何"已发放"信号。
    const { blockchain, u1, u2, jettonMaster, business } = await deploy(MERIT(100n));

    await u1.send({ to: business.address, value: MINT_PRICE + toNano('0.2'), body: incenseBody(110n) });
    const w1 = await walletOf(blockchain, jettonMaster, u1);
    expect((await w1.getGetWalletData()).balance).toBe(MERIT(88n));
    expect((await jettonMaster.getGetJettonData()).totalSupply).toBe(MERIT(88n));

    // 第二次上香：business 规则通过（66 MERIT 未超日供应）但 master mint 超上限失败
    const r2 = await u2.send({ to: business.address, value: MINT_PRICE + toNano('0.2'), body: incenseBody(111n) });
    expect(r2.transactions).toHaveTransaction({ to: business.address, success: true });

    // 失败路径不产生伪成功：付款人钱包从未部署（无 MERIT 资产）、master 供应不变
    const w2 = await walletOf(blockchain, jettonMaster, u2);
    const w2Account = await blockchain.getContract(w2.address);
    expect(w2Account.accountState?.type).not.toBe('active');
    expect((await jettonMaster.getGetJettonData()).totalSupply).toBe(MERIT(88n));
  });

  test('接收方失败 bounce 回滚不丢 MERIT', async () => {
    const { blockchain, u1, jettonMaster, business, seedMerit } = await deploy();

    await seedMerit(u1, MERIT(16n), 400n);
    const w1 = await walletOf(blockchain, jettonMaster, u1);
    expect((await w1.getGetWalletData()).balance).toBe(MERIT(16n));

    // 第一次求签成功（消耗 8）
    await w1.send(u1.getSender(), { value: toNano('0.2') }, {
      $$type: 'TokenTransfer' as const,
      queryId: 401n,
      amount: MERIT8,
      destination: business.address,
      responseDestination: u1.address,
      forwardTonAmount: toNano('0.05'),
      forwardPayload: drawPayload(401n),
    });
    expect((await w1.getGetWalletData()).balance).toBe(MERIT(8n));

    // 重复 query_id：business 拒绝 → internal bounce 回 wallet →
    // bounced 回滚使 MERIT 不丢（3.7 修复的 bounce 回滚路径）
    const dup = await w1.send(u1.getSender(), { value: toNano('0.2') }, {
      $$type: 'TokenTransfer' as const,
      queryId: 402n,
      amount: MERIT8,
      destination: business.address,
      responseDestination: u1.address,
      forwardTonAmount: toNano('0.05'),
      forwardPayload: drawPayload(401n), // 同 query_id → business 拒绝
    });
    expect(dup.transactions).toHaveTransaction({ to: business.address, success: false });
    expect((await w1.getGetWalletData()).balance).toBe(MERIT(8n)); // 弹回不丢

    // 乱序：resume 先于求签（未知 query_id）被拒
    const resumeEarly = await u1.send({
      to: business.address,
      value: toNano('0.2'),
      body: beginCell().store(storeResumeDraw({ $$type: 'ResumeDraw' as const, queryId: 999n })).endCell(),
    });
    expect(resumeEarly.transactions).toHaveTransaction({ to: business.address, success: false });
  });

  test('gas 预算：上香链与求签链费用上限', async () => {
    const { blockchain, u1, jettonMaster, business, seedMerit } = await deploy();

    await seedMerit(u1, MERIT(8n), 500n);
    const w1 = await walletOf(blockchain, jettonMaster, u1);

    const incense = await u1.send({ to: business.address, value: MINT_PRICE + toNano('0.3'), body: incenseBody(501n) });

    // 上香链（business + master + wallet）：总 gas 预算 0.05 TON（3.8 部署清单基线）
    const incenseFees = incense.transactions.reduce((acc, t) => acc + (t.totalFees.coins), 0n);
    expect(incenseFees).toBeLessThan(toNano('0.05'));

    const draw = await w1.send(u1.getSender(), { value: toNano('0.2') }, {
      $$type: 'TokenTransfer' as const,
      queryId: 502n,
      amount: MERIT8,
      destination: business.address,
      responseDestination: u1.address,
      forwardTonAmount: toNano('0.05'),
      forwardPayload: drawPayload(502n),
    });

    // 求签链（wallet + business + collection + item 部署）：预算 0.1 TON
    const drawFees = draw.transactions.reduce((acc, t) => acc + (t.totalFees.coins), 0n);
    expect(drawFees).toBeLessThan(toNano('0.1'));

    // 实测值记录（3.8 清单引用）
    console.log('[gas] incense chain:', incenseFees.toString(), 'nanoton; draw chain:', drawFees.toString(), 'nanoton');
  });
});

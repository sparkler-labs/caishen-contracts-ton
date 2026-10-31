// 上香规则测试（add-ton-chain-support 3.4）：成功、少付、每用户每日超限、
// 供应耗尽、重复 query_id、bounce 退回、excess 退回、Jetton 发放核验。
// 规则基线（EVM CyberFortuneGod）：全局每日序列 88/66/36/30 → 衰减；每用户每日 3 次。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { IncenseDraw, storeIncensePayment } from '../output/CaishenBusiness_IncenseDraw';
import { JettonMaster, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

const DECIMALS = 9n;
const TOTAL_SUPPLY_BY_DAY = 200n * 10n ** DECIMALS; // 缩小日供应使耗尽场景可在单日内触达
const DECREASE_COEFFICIENT = 2n;
const MINT_PRICE = toNano('0.1');
const MERIT = (n: bigint) => n * 10n ** DECIMALS;

function incenseBody(queryId: bigint) {
  return beginCell()
    .store(storeIncensePayment({ $$type: 'IncensePayment' as const, queryId }))
    .endCell();
}

describe('上香规则', () => {
  async function deploy() {
    const blockchain = await Blockchain.create();
    blockchain.now = Math.floor(Date.now() / 1000);
    const admin = await blockchain.treasury('admin');
    const user = await blockchain.treasury('user');
    const user2 = await blockchain.treasury('user2');
    const user3 = await blockchain.treasury('user3');
    const outsider = await blockchain.treasury('outsider');

    // JettonMaster 先部署（minter 后登记，对齐 EVM initMeritCoin 时序，打破
    // business↔master 循环依赖）；nftCollection 占位（3.5 求签铸造时接线）
    const jettonMaster: SandboxContract<JettonMaster> = blockchain.openContract(
      await JettonMaster.fromInit(admin.address, beginCell().endCell(), MERIT(1000000n), DECIMALS),
    );
    const business: SandboxContract<IncenseDraw> = blockchain.openContract(
      await IncenseDraw.fromInit(
        admin.address,
        jettonMaster.address,
        admin.address, // nftCollection 占位
        DECIMALS,
        BigInt(blockchain.now - 86400), // day 1
        DECREASE_COEFFICIENT,
        TOTAL_SUPPLY_BY_DAY,
        MINT_PRICE,
      ),
    );

    await admin.send({ to: jettonMaster.address, value: toNano('0.05'), init: jettonMaster.init });
    await admin.send({ to: business.address, value: toNano('0.1'), init: business.init });
    // minter = business 合约（3.2 授权铸造）
    await admin.send({
      to: jettonMaster.address,
      value: toNano('0.05'),
      body: beginCell()
        .store(storeSetMinter({ $$type: 'SetMinter' as const, minter: business.address }))
        .endCell(),
    });

    async function offer(from: SandboxContract<TreasuryContract>, queryId: bigint, value: bigint, bounce = false) {
      return from.send({ to: collection.address, value, bounce, body: incenseBody(queryId) });
    }

    const collection = business;
    return { blockchain, admin, user, user2, user3, outsider, jettonMaster, collection, offer };
  }

  async function userMeritBalance(blockchain: Blockchain, master: SandboxContract<JettonMaster>, owner: SandboxContract<TreasuryContract>) {
    const wallet = blockchain.openContract(await JettonWallet.fromInit(owner.address, master.address));
    return (await wallet.getGetWalletData()).balance;
  }

  test('成功首铸发放 88 MERIT 并核验 Jetton 发放', async () => {
    const { blockchain, user, jettonMaster, collection, offer } = await deploy();

    const balanceBefore = await user.getBalance();
    const result = await offer(user, 1n, MINT_PRICE + toNano('0.3'));
    expect(result.transactions).toHaveTransaction({ to: collection.address, success: true });

    expect(await collection.getTotalIncense()).toBe(1n);
    expect(await collection.getRemainingSupply()).toBe(TOTAL_SUPPLY_BY_DAY - MERIT(88n));
    expect(await userMeritBalance(blockchain, jettonMaster, user)).toBe(MERIT(88n));
    expect(await collection.getIncenseProcessed(1n)).toBe(true);

    // excess 退回：付款 = price + 0.3，gas 预留 0.01，其余应回到付款人
    const balanceAfter = await user.getBalance();
    const spentApprox = MINT_PRICE + toNano('0.05') + toNano('0.01') + toNano('0.02'); // price+铸造成本+预留+容差
    expect(balanceAfter).toBeGreaterThan(balanceBefore - spentApprox);
  });

  test('少付被拒且 bounceable 退回', async () => {
    const { user, collection, offer } = await deploy();

    const balanceBefore = await user.getBalance();
    const result = await offer(user, 2n, MINT_PRICE - toNano('0.02'), true);
    expect(result.transactions).toHaveTransaction({ to: collection.address, success: false });
    expect(await collection.getTotalIncense()).toBe(0n);

    // bounce 退回：付款人基本无损（扣 gas）
    expect(await user.getBalance()).toBeGreaterThan(balanceBefore - toNano('0.02'));
  });

  test('每用户每日至多三次且全局序列 88/66/36', async () => {
    const { blockchain, user, jettonMaster, collection, offer } = await deploy();

    await offer(user, 10n, MINT_PRICE + toNano('0.3'));
    await offer(user, 11n, MINT_PRICE + toNano('0.3'));
    await offer(user, 12n, MINT_PRICE + toNano('0.3'));
    expect(await userMeritBalance(blockchain, jettonMaster, user)).toBe(MERIT(88n + 66n + 36n));

    const fourth = await offer(user, 13n, MINT_PRICE + toNano('0.3'));
    expect(fourth.transactions).toHaveTransaction({ to: collection.address, success: false });
    expect(await collection.getUserMintCountToday(user.address)).toBe(3n);
    expect(await userMeritBalance(blockchain, jettonMaster, user)).toBe(MERIT(88n + 66n + 36n));
  });

  test('供应耗尽后拒绝', async () => {
    const { user, user2, collection, offer } = await deploy();

    // 日供应 200 MERIT：全局 1-4 次 88/66/36/30(截断为 10) → 第 5 次返回 0
    await offer(user, 20n, MINT_PRICE + toNano('0.3'));
    await offer(user, 21n, MINT_PRICE + toNano('0.3'));
    await offer(user, 22n, MINT_PRICE + toNano('0.3'));
    await offer(user2, 23n, MINT_PRICE + toNano('0.3'));
    expect(await collection.getRemainingSupply()).toBe(0n);

    const result = await offer(user2, 24n, MINT_PRICE + toNano('0.3'));
    expect(result.transactions).toHaveTransaction({ to: collection.address, success: false });
    expect(await collection.getRemainingSupply()).toBe(0n);
  });

  test('重复 query_id 被拒', async () => {
    const { user2, collection, offer } = await deploy();

    await offer(user2, 30n, MINT_PRICE + toNano('0.3'));
    const dup = await offer(user2, 30n, MINT_PRICE + toNano('0.3'), true);
    expect(dup.transactions).toHaveTransaction({ to: collection.address, success: false });
    // 供应不再重复扣减（首铸已重置，第二次全局第 2 次 66 未发生）
    expect(await collection.getTotalIncense()).toBe(1n);
  });

  test('序列衰减对齐 EVM 语义（第 4 次 30 截断为剩余量）', async () => {
    const { user, user2, collection, offer } = await deploy();

    await offer(user, 40n, MINT_PRICE + toNano('0.3')); // 88
    await offer(user, 41n, MINT_PRICE + toNano('0.3')); // 66
    await offer(user, 42n, MINT_PRICE + toNano('0.3')); // 36
    // 第 4 次 30 > 剩余 10（日供应 200-190）→ 截断为 10，发放给第 4 位付款人
    const result = await offer(user2, 43n, MINT_PRICE + toNano('0.3'));
    expect(result.transactions).toHaveTransaction({ to: collection.address, success: true });
    expect(await collection.getRemainingSupply()).toBe(0n);
    expect(await collection.getTotalIncense()).toBe(4n);
  });
});

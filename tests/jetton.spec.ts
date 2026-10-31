// MERIT Jetton 授权铸造测试（add-ton-chain-support 3.2）：
// 总供应、用户 Jetton Wallet、非授权铸造拒绝、8 MERIT 最小单位计算。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { JettonMaster, storeMint, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

// 设计定案（design D4）：精度由部署清单固定；测试取 TON 惯例 9 位，
// 8 MERIT = 8 * 10^9 最小单位。
const DECIMALS = 9n;
const MERIT8 = 8n * 10n ** DECIMALS;
const MAX_SUPPLY = 1_000_000n * 10n ** DECIMALS;

function mintBody(queryId: bigint, receiver: Address, amount: bigint) {
  return beginCell()
    .store(
      storeMint({
        $$type: 'Mint' as const,
        queryId,
        receiver,
        amount,
      }),
    )
    .endCell();
}

describe('MERIT Jetton 授权铸造', () => {
  async function deployMaster() {
    const blockchain = await Blockchain.create();
    const admin = await blockchain.treasury('admin');
    const minter = await blockchain.treasury('business-contract');
    const user = await blockchain.treasury('user');
    const outsider = await blockchain.treasury('outsider');

    const master: SandboxContract<JettonMaster> = blockchain.openContract(
      await JettonMaster.fromInit(admin.address, beginCell().endCell(), MAX_SUPPLY, DECIMALS),
    );

    const deployResult = await admin.send({
      to: master.address,
      value: toNano('0.05'),
      init: master.init,
    });
    expect(deployResult.transactions).toHaveTransaction({ to: master.address, success: true });

    // minter 登记（EVM initMeritCoin 时序）：主业务合约地址
    await admin.send({
      to: master.address,
      value: toNano('0.05'),
      body: beginCell()
        .store(storeSetMinter({ $$type: 'SetMinter' as const, minter: minter.address }))
        .endCell(),
    });

    return { blockchain, admin, minter, user, outsider, master };
  }

  test('授权铸造增加总供应并部署用户钱包', async () => {
    const { blockchain, minter, user, master } = await deployMaster();

    const mintResult = await minter.send({
      to: master.address,
      value: toNano('0.1'),
      body: mintBody(1n, user.address, MERIT8),
    });

    expect(mintResult.transactions).toHaveTransaction({ to: master.address, success: true });
    // 铸造消息链：master → 用户钱包（internal transfer 部署入账）
    expect(mintResult.transactions).toHaveTransaction({ endStatus: 'active', success: true });

    const data = await master.getGetJettonData();
    expect(data.totalSupply).toBe(MERIT8);

    expect(mintResult.transactions).toHaveTransaction({
      to: await master.getGetWalletAddress(user.address),
      deploy: true,
      success: true,
    });

    // 用户钱包地址由 master 推导（TEP-89），钱包内余额一致
    const expectedWallet = await master.getGetWalletAddress(user.address);
    const wallet = blockchain.openContract(await JettonWallet.fromInit(user.address, master.address));
    expect(wallet.address.equals(expectedWallet)).toBe(true);

    const walletData = await wallet.getGetWalletData();
    expect(walletData.balance).toBe(MERIT8);
    expect(walletData.owner.equals(user.address)).toBe(true);
    expect(walletData.master.equals(master.address)).toBe(true);
  });

  test('非授权铸造被拒绝', async () => {
    const { outsider, user, master } = await deployMaster();

    const result = await outsider.send({
      to: master.address,
      value: toNano('0.1'),
      body: mintBody(2n, user.address, MERIT8),
    });

    expect(result.transactions).toHaveTransaction({
      to: master.address,
      success: false,
      aborted: true,
    });

    const data = await master.getGetJettonData();
    expect(data.totalSupply).toBe(0n);
  });

  test('8 MERIT 最小单位计算与精度暴露', async () => {
    const { blockchain, minter, user, master } = await deployMaster();

    expect(await master.getGetDecimals()).toBe(DECIMALS);

    // 恰好 8 MERIT：钱包余额精确等于最小单位数，无舍入
    await minter.send({
      to: master.address,
      value: toNano('0.1'),
      body: mintBody(3n, user.address, MERIT8),
    });

    const wallet = blockchain.openContract(await JettonWallet.fromInit(user.address, master.address));
    const walletData = await wallet.getGetWalletData();
    expect(walletData.balance).toBe(8_000_000_000n);
    expect(walletData.balance).toBe(MERIT8);
  });

  test('总供应守恒且上限拒绝', async () => {
    const { minter, user, master } = await deployMaster();

    for (const queryId of [4n, 5n]) {
      await minter.send({
        to: master.address,
        value: toNano('0.1'),
        body: mintBody(queryId, user.address, MERIT8),
      });
    }
    expect((await master.getGetJettonData()).totalSupply).toBe(2n * MERIT8);

    // 超过 maxSupply 的铸造被拒绝，供应不变
    const result = await minter.send({
      to: master.address,
      value: toNano('0.1'),
      body: mintBody(6n, user.address, MAX_SUPPLY + 10n ** DECIMALS),
    });
    expect(result.transactions).toHaveTransaction({ to: master.address, success: false });
    expect((await master.getGetJettonData()).totalSupply).toBe(2n * MERIT8);
  });
});

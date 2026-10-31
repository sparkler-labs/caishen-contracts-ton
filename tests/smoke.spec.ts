// 冒烟测试（add-ton-chain-support 3.1）：验证 @ton/sandbox 工具链可用——
// 合约可部署、可调用、getter 可读。3.2 起的业务规则测试按任务逐条落地。
import '@ton/test-utils';

import { toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { IncenseDraw } from '../output/CaishenBusiness_IncenseDraw';

describe('IncenseDraw 骨架冒烟', () => {
  test('部署与 getter 可用', async () => {
    const blockchain = await Blockchain.create();
    const admin = await blockchain.treasury('admin');
    const jettonMaster = await blockchain.treasury('jetton-master');
    const nftCollection = await blockchain.treasury('nft-collection');

    const contract: SandboxContract<IncenseDraw> = blockchain.openContract(
      await IncenseDraw.fromInit(
        admin.address,
        jettonMaster.address,
        nftCollection.address,
        9n,
        BigInt(Math.floor(Date.now() / 1000) - 86400),
        2n,
        toNano('1000'),
        toNano('0.1'),
      ),
    );

    const deployResult = await admin.send({
      to: contract.address,
      value: toNano('0.05'),
      init: contract.init,
    });
    expect(deployResult.transactions).toHaveTransaction({
      to: contract.address,
      success: true,
    });

    expect((await contract.getIncensePrice()).toString()).toBe(toNano('0.1').toString());
    expect(await contract.getTotalIncense()).toBe(0n);
  });
});

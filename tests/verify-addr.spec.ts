import { Address, contractAddress, beginCell } from '@ton/core';
import { Blockchain } from '@ton/sandbox';
import { test } from '@jest/globals';
import * as fs from 'fs';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

test('contractAddress 复现 wallet 地址', async () => {
  const blockchain = await Blockchain.create();
  const admin = await blockchain.treasury('admin');
  const user = await blockchain.treasury('user');
  const master = blockchain.openContract(
    await JettonMaster.fromInit(admin.address, beginCell().endCell(), 1000n * 10n ** 9n, 9n),
  );
  const init = await JettonWallet.fromInit(user.address, master.address);

  const viaContractAddress = contractAddress(0, { code: init.init?.code as any, data: init.init?.data as any });
  console.log('init.address   :', init.address.toString());
  console.log('contractAddress:', viaContractAddress.toString());
  console.log('match:', viaContractAddress.equals(init.address));

  // StateInit repr 逐层取证：root cell 的 hash 与地址 hash 的关系
  const root = beginCell().storeRef(init.init?.code as any).storeRef(init.init?.data as any).endCell();
  console.log('root hash      :', root.hash().toString('hex'));
  console.log('addr hash      :', init.address.hash.toString('hex'));
  console.log('root==addr     :', root.hash().toString('hex') === init.address.hash.toString('hex'));
  console.log('addr.hash type :', (init.address.hash as any) instanceof Buffer ? 'Buffer' : typeof init.address.hash);
}, 30000);

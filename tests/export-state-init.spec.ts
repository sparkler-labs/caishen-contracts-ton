// StateInit 取证（4.3/4.4 前置）：dump wallet init code/data cell hash 供后端
// BOC 解析器对照验证（真实执行向量）。
import { beginCell, toNano } from '@ton/core';
import { Blockchain } from '@ton/sandbox';
import { test } from '@jest/globals';
import * as fs from 'fs';

import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

test('dump StateInit cell hashes', async () => {
  const blockchain = await Blockchain.create();
  const admin = await blockchain.treasury('admin');
  const user = await blockchain.treasury('user');
  const master = blockchain.openContract(
    await JettonMaster.fromInit(admin.address, beginCell().endCell(), 1000n * 10n ** 9n, 9n),
  );
  const init = await JettonWallet.fromInit(user.address, master.address);

  const outPath = '../backend/test/services/chain_family/fixtures/ton_state_init.json';
  fs.writeFileSync(outPath, JSON.stringify({
    owner: user.address.toString(),
    master: master.address.toString(),
    wallet_address: init.address.toString(),
    wallet_raw: `0:${init.address.hash.toString('hex')}`,
    code_cell_hash: init.init?.code.hash().toString('hex'),
    data_cell_hash: init.init?.data.hash().toString('hex'),
    code_boc_hex: init.init?.code.toBoc().toString('hex'),
    data_boc_hex: init.init?.data.toBoc().toString('hex'),
  }, null, 2));
  console.log('state init vectors written:', outPath);
}, 30000);

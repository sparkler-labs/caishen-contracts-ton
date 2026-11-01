// 3.8 Node 侧核验（blueprint 载入 TS 绑定，不做链上 get 调用）
import { Address, beginCell } from '@ton/core';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

export async function run(provider: any) {
  const sender = provider.sender() as any;
  const admin = sender.address;
  const ui = provider.ui();

  const jettonContent = beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/merit-v2.json').endCell();
  const master = await JettonMaster.fromInit(admin, jettonContent, 1000000n * 10n ** 9n, 9n);
  const jettonWallet = await JettonWallet.fromInit(admin, master.address);
  ui.write(`ADMIN_RAW=0:${admin.hash.toString('hex')}`);
  ui.write(`MASTER_RAW=0:${master.address.hash.toString('hex')}`);
  ui.write(`JETTON_WALLET_RAW=0:${jettonWallet.address.hash.toString('hex')}`);
}

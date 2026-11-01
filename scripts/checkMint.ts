// 3.8 冒烟核验：total_supply、admin Jetton Wallet 余额（链上 get-method 权威）
import { Address, beginCell, toNano } from '@ton/core';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';

const DECIMALS = 9n;
const MAX_MERIT_SUPPLY = 1_000_000n * 10n ** DECIMALS;

export async function run(provider: any) {
  const sender = provider.sender() as any;
  const admin = sender.address;
  const ui = provider.ui();

  const jettonMaster = provider.open(
    await JettonMaster.fromInit(admin, beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/merit-v2.json').endCell(), MAX_MERIT_SUPPLY, DECIMALS),
  );
  const data = await jettonMaster.getGetJettonData();
  ui.write(`MERIT total_supply = ${data.totalSupply}（期望 88e9=88000000000）`);

  const adminWallet = provider.open(
    await JettonWallet.fromInit(admin, jettonMaster.address),
  );
  const walletData = await adminWallet.getGetWalletData();
  ui.write(`admin Jetton Wallet = ${adminWallet.address.toString()}`);
  ui.write(`admin MERIT 余额 = ${walletData.balance}（期望 88000000000）`);
}

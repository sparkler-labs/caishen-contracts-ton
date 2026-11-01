// 3.8 冒烟核验（避开 gas 星饥的 get_jetton_data）：get_wallet_address 推导
// admin 的 Jetton Wallet 地址，再查链上状态与 get_wallet_data。
import { beginCell, toNano } from '@ton/core';
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
  const walletAddress = await jettonMaster.getGetWalletAddress(admin);
  ui.write(`ADMIN_JETTON_WALLET_RAW=${walletAddress.toString()}`);

  const wallet = provider.open(await JettonWallet.fromInit(admin, jettonMaster.address));
  const data = await wallet.getGetWalletData();
  ui.write(`WALLET_BALANCE=${data.balance}`);
}

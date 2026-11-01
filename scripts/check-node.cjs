// 3.8 Node 侧核验（CJS）
const { Address, beginCell } = require('@ton/core');
const { mnemonicToPrivateKey } = require('@ton/crypto');
const { WalletContractV5R1 } = require('@ton/ton');
const { JettonMaster } = require('../output/CaishenJetton_JettonMaster.js');
const { JettonWallet } = require('../output/CaishenJetton_JettonWallet.js');

async function main() {
  const mnemonic = process.env.WALLET_MNEMONIC.trim().split(/\s+/);
  const keys = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({
    publicKey: keys.publicKey,
    workchain: 0,
    walletId: { networkGlobalId: -3, context: { workchain: 0, subwalletNumber: 0, walletVersion: 'v5r1' } },
  });
  const admin = wallet.address;
  console.log('admin:', admin.toString());

  const DECIMALS = 9n;
  const jettonContent = beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/merit-v2.json').endCell();
  const master = await JettonMaster.fromInit(admin, jettonContent, 1000000n * 10n ** DECIMALS, DECIMALS);
  console.log('master:', master.address.toString());

  const jettonWallet = await JettonWallet.fromInit(admin, master.address);
  console.log('admin_jetton_wallet_raw: 0:' + jettonWallet.address.hash.toString('hex'));
}
main().catch((e) => { console.error('ERR:', e.message); process.exit(1); });

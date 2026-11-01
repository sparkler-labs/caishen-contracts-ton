// 3.8 Node 侧核验：链下推导 admin Jetton Wallet 地址（避免 runGetMethod gas 限制）
import { Address, beginCell, toNano } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster.js';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet.js';

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
const master = await JettonMaster.fromInit(admin, jettonContent, 1_000_000n * 10n ** DECIMALS, DECIMALS);
console.log('master:', master.address.toString());

const jettonWallet = await JettonWallet.fromInit(admin, master.address);
console.log('admin jetton wallet:', jettonWallet.address.toString());
console.log('wallet raw:', `0:${jettonWallet.address.hash.toString('hex')}`);

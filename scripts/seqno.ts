import { WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';

export async function run(provider: any) {
  const mnemonic = process.env.WALLET_MNEMONIC!.trim().split(/\s+/);
  const keys = await mnemonicToPrivateKey(mnemonic);
  const wallet = WalletContractV5R1.create({ publicKey: keys.publicKey, workchain: 0 });
  const wc = provider.open(wallet);
  const seqno = await wc.getSeqno();
  const balance = await wc.getBalance();
  console.log(`SEQNO=${seqno} BALANCE=${balance.toString()}`);
}

// 3.8 v4 钱包引导（add-ton-chain-support）：从 v5 钱包向同助记词派生的 v4 钱包
// 地址发 StateInit 部署 + 注资——绕开 Blueprint v5r1 MnemonicProvider 的间歇性
// 空动作问题，后续部署走 v4 签名路径。
import { toNano } from '@ton/core';
import { WalletContractV4 } from '@ton/ton';

export async function run(provider: any) {
  const sender = provider.sender() as any;
  const ui = provider.ui();

  const keyPair = (provider as any).mnemonicProvider?.secretKey
    ? { secretKey: (provider as any).mnemonicProvider.secretKey }
    : null;
  // blueprint MnemonicProvider 不暴露 keyPair——从 env 助记词重派生（同钥）
  const { mnemonicToPrivateKey } = await import('@ton/crypto');
  const mnemonic = process.env.WALLET_MNEMONIC!.trim().split(/\s+/);
  const keys = await mnemonicToPrivateKey(mnemonic);

  const v4 = WalletContractV4.create({ workchain: 0, publicKey: keys.publicKey });
  ui.write(`v4 地址: ${v4.address.toString()}`);
  ui.write(`v4 raw : 0:${v4.address.hash.toString('hex')}`);

  await sender.send({
    to: v4.address,
    value: toNano('0.5'),
    init: v4.init,
  });
  ui.write('v4 钱包部署+注资消息已发送（0.5 TON）');
}

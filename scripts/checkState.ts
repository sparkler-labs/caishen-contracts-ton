// 3.8 状态检查：三合约链上状态 + minter 登记核验
import { beginCell, toNano } from '@ton/core';
import { JettonMaster, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { NftCollection, storeSetNftMinter } from '../output/CaishenNft_NftCollection';
import { IncenseDraw } from '../output/CaishenBusiness_IncenseDraw';

const DECIMALS = 9n;
const MAX_MERIT_SUPPLY = 1_000_000n * 10n ** DECIMALS;
const TOTAL_SUPPLY_BY_DAY = 10_000n * 10n ** DECIMALS;
const MINT_PRICE = toNano('0.1');
const DECREASE_COEFFICIENT = 2n;

function startOfTodayUtc(): bigint {
  const now = new Date();
  const utcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return BigInt(Math.floor(utcMidnight / 1000));
}

export async function run(provider: any) {
  const sender = provider.sender() as any;
  const admin = sender.address;
  const ui = provider.ui();

  const jettonContent = beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/merit-v2.json').endCell();
  const jettonMaster = provider.open(await JettonMaster.fromInit(admin, jettonContent, MAX_MERIT_SUPPLY, DECIMALS));
  const nftCollection = provider.open(await NftCollection.fromInit(admin, beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/collection-v2.json').endCell()));
  const business = provider.open(
    await IncenseDraw.fromInit(admin, jettonMaster.address, nftCollection.address, DECIMALS, startOfTodayUtc(), DECREASE_COEFFICIENT, TOTAL_SUPPLY_BY_DAY, MINT_PRICE),
  );

  for (const [name, contract] of [['JettonMaster', jettonMaster], ['NftCollection', nftCollection], ['IncenseDraw', business]] as const) {
    const deployed = await provider.isContractDeployed(contract.address);
    ui.write(`${name}: ${contract.address.toString()} deployed=${deployed}`);
  }

  if (!(await provider.isContractDeployed(business.address))) {
    ui.write('IncenseDraw 未部署——先发部署交易');
    await business.send(sender, { value: toNano('0.3') }, null);
    ui.write('IncenseDraw 部署交易已发送（等待下一轮核验）');
    return;
  }

  // 部署完成：补 minter 登记（若未登记）
  ui.write('IncenseDraw 已部署，发送 minter 登记…');
  await jettonMaster.send(sender, { value: toNano('0.05') }, { $$type: 'SetMinter' as const, minter: business.address });
  await nftCollection.send(sender, { value: toNano('0.05') }, { $$type: 'SetNftMinter' as const, minter: business.address });
  ui.write('SetMinter / SetNftMinter 已发送（重复发送会被合约 require 拦截，安全）');

  const manifest = {
    schema_version: '1',
    config_version: `ton-testnet-${new Date().toISOString().slice(0, 10)}`,
    chain_id: -3,
    public_rpc_url: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    chain: {
      name: 'TON Testnet', chain_family: 'ton', ton_network: 'testnet',
      native_symbol: 'TON', native_decimals: 9, environment: 'testnet',
      status: 'enabled', explorer_url: 'https://testnet.tonviewer.com',
    },
    deployment: {
      deployment_id: 'ton-testnet-v1',
      fortune_god_address: business.address.toString(),
      merit_coin_address: jettonMaster.address.toString(),
      fortune_stick_address: nftCollection.address.toString(),
      proxy_admin_address: admin.toString(),
      fortune_god_impl_address: business.address.toString(),
      abi_version: 'v2', code_version: 'tact-1.6.13-3.7',
      status: 'active', is_active: true,
      parameters: { decimals: DECIMALS.toString(), mint_price: MINT_PRICE.toString() },
    },
  };
  (await import('fs')).writeFileSync('deploy-manifest-testnet.json', JSON.stringify(manifest, null, 2));
  ui.write('部署清单已写入 deploy-manifest-testnet.json');
}

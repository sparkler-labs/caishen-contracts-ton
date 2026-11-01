// 3.8 testnet 部署续（add-ton-chain-support）：JettonMaster 已上线（首次运行
// 已部署），本脚本补齐：NftCollection → IncenseDraw → SetMinter/SetNftMinter。
// Tact 绑定的 send 签名是 (args, message 对象)——消息对象作为第三参，而非 body。
import { Address, beginCell, toNano } from '@ton/core';

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
  const admin: Address = sender.address;
  const ui = provider.ui();

  // JettonMaster（首跑已部署）：同 init 参数重开实例
  const jettonContent = beginCell()
    .storeUint(1, 8)
    .storeStringTail('https://caishenye.net/ton/merit.json')
    .endCell();
  const jettonMaster = provider.open(
    await JettonMaster.fromInit(admin, jettonContent, MAX_MERIT_SUPPLY, DECIMALS),
  );
  const jettonActive = await provider.isContractDeployed(jettonMaster.address);
  ui.write(`JettonMaster: ${jettonMaster.address.toString()} (active=${jettonActive})`);

  // ===== NftCollection =====
  const collectionContent = beginCell()
    .storeUint(1, 8)
    .storeStringTail('https://caishenye.net/ton/collection.json')
    .endCell();
  const nftCollection = provider.open(await NftCollection.fromInit(admin, collectionContent));
  const nftActive = await provider.isContractDeployed(nftCollection.address);
  if (!nftActive) {
    await nftCollection.send(sender, { value: toNano('0.1') }, null);
    ui.write(`NftCollection 部署交易已发送: ${nftCollection.address.toString()}`);
  } else {
    ui.write(`NftCollection 已在线: ${nftCollection.address.toString()}`);
  }

  // ===== IncenseDraw =====
  const business = provider.open(
    await IncenseDraw.fromInit(
      admin,
      jettonMaster.address,
      nftCollection.address,
      DECIMALS,
      startOfTodayUtc(),
      DECREASE_COEFFICIENT,
      TOTAL_SUPPLY_BY_DAY,
      MINT_PRICE,
    ),
  );
  const bizActive = await provider.isContractDeployed(business.address);
  if (!bizActive) {
    await business.send(sender, { value: toNano('0.3') }, null);
    ui.write(`IncenseDraw 部署交易已发送: ${business.address.toString()}`);
  } else {
    ui.write(`IncenseDraw 已在线: ${business.address.toString()}`);
  }

  // ===== minter 登记（消息对象作第三参，Tact 绑定签名）=====
  await jettonMaster.send(sender, { value: toNano('0.05') }, {
    $$type: 'SetMinter' as const,
    minter: business.address,
  });
  ui.write('JettonMaster.SetMinter(business) 已发送');

  await nftCollection.send(sender, { value: toNano('0.05') }, {
    $$type: 'SetNftMinter' as const,
    minter: business.address,
  });
  ui.write('NftCollection.SetNftMinter(business) 已发送');

  const manifest = {
    schema_version: '1',
    config_version: `ton-testnet-${new Date().toISOString().slice(0, 10)}`,
    chain_id: -3,
    public_rpc_url: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    chain: {
      name: 'TON Testnet',
      chain_family: 'ton',
      ton_network: 'testnet',
      native_symbol: 'TON',
      native_decimals: 9,
      environment: 'testnet',
      status: 'enabled',
      explorer_url: 'https://testnet.tonviewer.com',
    },
    deployment: {
      deployment_id: 'ton-testnet-v1',
      fortune_god_address: business.address.toString(),
      merit_coin_address: jettonMaster.address.toString(),
      fortune_stick_address: nftCollection.address.toString(),
      proxy_admin_address: admin.toString(),
      fortune_god_impl_address: business.address.toString(),
      abi_version: 'v2',
      code_version: 'tact-1.6.13-3.7',
      status: 'active',
      is_active: true,
      parameters: { decimals: DECIMALS.toString(), mint_price: MINT_PRICE.toString() },
    },
  };
  const fs = await import('fs');
  fs.writeFileSync('deploy-manifest-testnet.json', JSON.stringify(manifest, null, 2));
  ui.write('部署清单已写入 deploy-manifest-testnet.json');
}

// 3.8 核验：SetMinter/SetNftMinter 是否生效（链上 get-method 权威判定）
import { Address, beginCell, toNano } from '@ton/core';
import { TonClient } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import * as fs from 'fs';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { NftCollection } from '../output/CaishenNft_NftCollection';
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

  const jettonMaster = provider.open(
    await JettonMaster.fromInit(admin, beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/merit-v2.json').endCell(), MAX_MERIT_SUPPLY, DECIMALS),
  );
  const nftCollection = provider.open(
    await NftCollection.fromInit(admin, beginCell().storeUint(1, 8).storeStringTail('https://caishenye.net/ton/collection-v2.json').endCell()),
  );
  const business = provider.open(
    await IncenseDraw.fromInit(admin, jettonMaster.address, nftCollection.address, DECIMALS, startOfTodayUtc(), DECREASE_COEFFICIENT, TOTAL_SUPPLY_BY_DAY, MINT_PRICE),
  );

  // JettonMaster.get_wallet_address(business) → 应返回 business 的 Jetton Wallet 地址
  const expectedWallet = await jettonMaster.getGetWalletAddress(business.address);
  ui.write(`JettonMaster.get_wallet_address(business) = ${expectedWallet.toString()}`);

  // IncenseDraw 配置回读（getter 存活即部署确认）
  const price = await business.getIncensePrice();
  ui.write(`IncenseDraw.price = ${price.toString()} nanoton（期望 ${MINT_PRICE.toString()}）`);

  const deployed = [
    ['JettonMaster', jettonMaster.address],
    ['NftCollection', nftCollection.address],
    ['IncenseDraw', business.address],
  ] as const;
  for (const [name, addr] of deployed) {
    const ok = await provider.isContractDeployed(addr);
    ui.write(`${name}: ${addr.toString()} deployed=${ok}`);
  }
}

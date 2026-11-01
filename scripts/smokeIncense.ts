// 3.8 真实端到端冒烟：IncensePayment → Jetton 铸造 → 用户钱包入账。
// 同步抓取交易哈希供 trace fixture 使用。
import { Address, beginCell, toNano } from '@ton/core';
import { IncenseDraw, storeIncensePayment } from '../output/CaishenBusiness_IncenseDraw';
import { JettonMaster } from '../output/CaishenJetton_JettonMaster';
import { NftCollection } from '../output/CaishenNft_NftCollection';

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

  const body = beginCell()
    .store(storeIncensePayment({ $$type: 'IncensePayment' as const, queryId: 1000n }))
    .endCell();
  await sender.send({
    to: business.address,
    value: MINT_PRICE + toNano('0.05'),
    body,
  });
  ui.write(`上香交易已发送（query_id=1000）。发送钱包: ${admin.toString()}`);
  ui.write(`business: ${business.address.toString()}`);
}

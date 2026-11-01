// fixture 导出（add-ton-chain-support 4.3/4.4 前置）：跑通完整上香/求签/恢复流，
// 将 sandbox 真实执行的交易链序列化为后端 TON trace 验证的 fixture JSON。
// 合约代码与 testnet 部署同源（3.1-3.7 产物），字段形态对齐 toncenter v3
// transactions/traces（lt/hash/in_msg/out_msgs）；testnet 相关性由 3.8/7.1 补核。
import '@ton/test-utils';

import { beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

import { IncenseDraw, loadIncensePayment, storeIncensePayment } from '../output/CaishenBusiness_IncenseDraw';
import { JettonMaster, loadMint, loadTokenTransferInternal, storeMint, storeSetMinter } from '../output/CaishenJetton_JettonMaster';
import { JettonWallet } from '../output/CaishenJetton_JettonWallet';
import { NftCollection, loadInitNftItem, loadItemDeployed, loadMintNFT, loadNFTTransfer, storeSetNftMinter } from '../output/CaishenNft_NftCollection';

const DECIMALS = 9n;
const MERIT8 = 8n * 10n ** DECIMALS;

function addrKey(address: any): string {
  // toncenter 风格 raw 地址（-1: / 0: 前缀）
  const wc = address.workChain ?? 0;
  return `${wc}:${Buffer.from(address.hash).toString('hex')}`;
}

// 语义解析（Node 绑定承担 BOC 解码，后端验证关系/金额/query_id 规则）
function parseMessage(body: any): any {
  if (!body) {
    return null;
  }
  const sc = body.beginParse();
  const op = sc.preloadUint(32);
  const parse = (fn: (s: any) => any) => {
    const m = fn(body.beginParse());
    return m;
  };
  if (op === 0x17804522) {
    const m = parse(loadTokenTransferInternal);
    // 求签入口的 query_id 载于 forwardPayload（合约 loadUint(64)），与消息顶层
    // queryId 是两个独立字段（测试中设为同值）；后端验证需分别可见
    let fpQueryId: string | null = null;
    try {
      fpQueryId = m.forwardPayload.loadUint(64).toString();
    } catch {
      fpQueryId = null;
    }
    return { kind: 'TokenTransferInternal', op: op.toString(16), query_id: m.queryId.toString(), amount: m.amount.toString(), from: addrKey(m.from), forward_payload_query_id: fpQueryId };
  }
  if (op === 0xc15edfb9) {
    const m = parse(loadMint);
    return { kind: 'Mint', op: op.toString(16), query_id: m.queryId.toString(), amount: m.amount.toString(), receiver: addrKey(m.receiver) };
  }
  if (op === 0x805c4914) {
    const m = parse(loadIncensePayment);
    return { kind: 'IncensePayment', op: op.toString(16), query_id: m.queryId.toString() };
  }
  if (op === 0x7bdd97de) {
    return { kind: 'TokenExcesses', op: op.toString(16) };
  }
  if (op === 0x25d1b7f9) {
    const m = parse(loadMintNFT);
    return { kind: 'MintNFT', op: op.toString(16), query_id: m.queryId.toString(), to_owner: addrKey(m.toOwner) };
  }
  if (op === 0x5fcc3d14) {
    const m = parse(loadNFTTransfer);
    return { kind: 'NFTTransfer', op: op.toString(16), new_owner: addrKey(m.newOwner), query_id: m.queryId.toString() };
  }
  if (op === 0x0e219a2e) {
    const m = parse(loadInitNftItem);
    return { kind: 'InitNftItem', op: op.toString(16), owner: addrKey(m.owner), stick_no: m.stickNo.toString() };
  }
  if (op === 0xad34f0bc) {
    const m = parse(loadItemDeployed);
    return { kind: 'ItemDeployed', op: op.toString(16), query_id: m.queryId.toString(), item_index: m.itemIndex.toString(), stick_no: m.stickNo.toString() };
  }
  return { kind: 'unknown', op: op.toString(16) };
}

function serializeTx(t: any) {
  const inMsg = t.inMessage;
  const body = inMsg?.body;
  return {
    hash: Buffer.from(t.hash()).toString('base64'),
    lt: (t.lt ?? inMsg?.lt ?? 0).toString(),
    now: t.now,
    account: addrKey(inMsg?.info?.dest ?? {}),
    src: inMsg?.info?.src ? addrKey(inMsg.info.src) : null,
    in_value: inMsg?.info?.value?.coins?.toString() ?? '0',
    in_message: parseMessage(body),
    out_messages: (t.outMessages ?? []).values().map((m: any) => ({
      parsed: parseMessage(m.body),
      dest: addrKey(m.info.dest),
      value: m.info.value?.coins?.toString() ?? '0',
    })),
    total_fees: t.totalFees?.coins?.toString() ?? '0',
    aborted: t.description?.aborted ?? false,
    exit_code: t.description?.computePhase?.exitCode ?? null,
  };
}

test('导出上香与求签 trace fixture', async () => {
  const blockchain = await Blockchain.create();
  blockchain.now = Math.floor(Date.now() / 1000);
  const admin = await blockchain.treasury('admin');
  const user = await blockchain.treasury('user');

  const jettonMaster: SandboxContract<JettonMaster> = blockchain.openContract(
    await JettonMaster.fromInit(admin.address, beginCell().endCell(), 1000000n * 10n ** DECIMALS, DECIMALS),
  );
  const nftCollection: SandboxContract<NftCollection> = blockchain.openContract(
    await NftCollection.fromInit(admin.address, beginCell().endCell()),
  );
  const business: SandboxContract<IncenseDraw> = blockchain.openContract(
    await IncenseDraw.fromInit(
      admin.address,
      jettonMaster.address,
      nftCollection.address,
      DECIMALS,
      BigInt(blockchain.now - 86400),
      2n,
      200n * 10n ** DECIMALS,
      toNano('0.1'),
    ),
  );

  await admin.send({ to: jettonMaster.address, value: toNano('0.05'), init: jettonMaster.init });
  await admin.send({
    to: jettonMaster.address,
    value: toNano('0.05'),
    body: beginCell().store(storeSetMinter({ $$type: 'SetMinter' as const, minter: business.address })).endCell(),
  });
  await admin.send({ to: nftCollection.address, value: toNano('0.1'), init: nftCollection.init });
  await admin.send({
    to: nftCollection.address,
    value: toNano('0.05'),
    body: beginCell().store(storeSetNftMinter({ $$type: 'SetNftMinter' as const, minter: business.address })).endCell(),
  });
  await admin.send({ to: business.address, value: toNano('0.3'), init: business.init });

  // 上香流：付款 → master 铸 → 用户钱包入账
  const incenseRun = await user.send({
    to: business.address,
    value: toNano('0.1') + toNano('0.2'),
    body: beginCell().store(storeIncensePayment({ $$type: 'IncensePayment' as const, queryId: 100n })).endCell(),
  });

  // 求签流：8 MERIT 转移 → business 登记 → collection 铸 item
  const userWallet = blockchain.openContract(await JettonWallet.fromInit(user.address, jettonMaster.address));
  const drawRun = await userWallet.send(user.getSender(), { value: toNano('0.2') }, {
    $$type: 'TokenTransfer' as const,
    queryId: 101n,
    amount: MERIT8,
    destination: business.address,
    responseDestination: user.address,
    forwardTonAmount: toNano('0.05'),
    forwardPayload: beginCell().storeUint(101n, 64).endCell().asSlice(),
  });

  // 转移链（4.5 fixture）：item 0 由 user 转给 admin（NFTTransfer 标准消息）
  const { NftItem } = await import('../output/CaishenNft_NftItem');
  const item0 = blockchain.openContract(await NftItem.fromInit(nftCollection.address, 0n));
  const transferRun = await item0.send(user.getSender(), { value: toNano('0.1') }, {
    $$type: 'NFTTransfer' as const,
    queryId: 102n,
    newOwner: admin.address,
    responseDestination: user.address,
    forwardAmount: 0n,
    forwardPayload: beginCell().endCell().asSlice(),
  });

  const fixture = {
    network: 'sandbox' as const,
    contract_versions: { tact: '1.6.13', generated_from: 'contracts-ton 3.7' },
    addresses: {
      business: addrKey(business.address),
      jetton_master: addrKey(jettonMaster.address),
      nft_collection: addrKey(nftCollection.address),
      user: addrKey(user.address),
      user_jetton_wallet: addrKey(userWallet.address),
    },

    incense_trace: {
      query_id: 100n.toString(),
      transactions: incenseRun.transactions.map(serializeTx),
    },
    draw_trace: {
      query_id: 101n.toString(),
      transactions: drawRun.transactions.map(serializeTx),
    },
    transfer_trace: {
      query_id: 102n.toString(),
      item_index: '0',
      item_address: addrKey(item0.address),
      nft_collection: addrKey(nftCollection.address),
      previous_owner: addrKey(user.address),
      new_owner: addrKey(admin.address),
      transactions: transferRun.transactions.map(serializeTx),
    },
  };

  const outDir = path.resolve(__dirname, '../../backend/test/services/chain_family/fixtures');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ton_incense_trace.json'), JSON.stringify(fixture, null, 2));
  console.log('fixture written:', path.join(outDir, 'ton_incense_trace.json'),
    'incense txs:', fixture.incense_trace.transactions.length,
    'draw txs:', fixture.draw_trace.transactions.length);
}, 60000);

// 签文 NFT（TEP-62）测试（add-ton-chain-support 3.3）：
// 单调 item index 与当前所有者、非授权铸造拒绝、地址稳定性（重复 index 的结构
// 防护）、钱包可识别 metadata（TEP-64）、标准转移。
import '@ton/test-utils';

import { Address, beginCell, toNano } from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { describe, expect, test } from '@jest/globals';

import { NftCollection, storeMintNFT, storeNFTTransfer } from '../output/CaishenNft_NftCollection';
import { NftItem } from '../output/CaishenNft_NftItem';

// TEP-64 snake 格式 #1：0x01 前缀 + off-chain URI（钱包可识别形态）
function tep64Content(uri: string) {
  return beginCell().storeUint(1, 8).storeStringTail(uri).endCell();
}

function mintBody(queryId: bigint, toOwner: Address, metadata: import('@ton/core').Cell) {
  return beginCell()
    .store(storeMintNFT({ $$type: 'MintNFT' as const, queryId, toOwner, metadata }))
    .endCell();
}

function transferBody(queryId: bigint, newOwner: Address) {
  return beginCell()
    .store(
      storeNFTTransfer({
        $$type: 'NFTTransfer' as const,
        queryId,
        newOwner,
        responseDestination: null,
        forwardAmount: 0n,
        forwardPayload: beginCell().endCell().asSlice(),
      }),
    )
    .endCell();
}

describe('签文 NFT Collection/Item', () => {
  async function deployCollection() {
    const blockchain = await Blockchain.create();
    const admin = await blockchain.treasury('admin');
    const minter = await blockchain.treasury('business-contract');
    const alice = await blockchain.treasury('alice');
    const bob = await blockchain.treasury('bob');
    const outsider = await blockchain.treasury('outsider');

    const collection: SandboxContract<NftCollection> = blockchain.openContract(
      await NftCollection.fromInit(admin.address, minter.address, tep64Content('https://caishenye.net/ton/collection.json')),
    );

    const deployResult = await admin.send({
      to: collection.address,
      value: toNano('0.05'),
      init: collection.init,
    });
    expect(deployResult.transactions).toHaveTransaction({ to: collection.address, success: true });

    async function mint(queryId: bigint, toOwner: Address) {
      return minter.send({
        to: collection.address,
        value: toNano('0.2'),
        body: mintBody(queryId, toOwner, tep64Content(`https://caishenye.net/ton/item-${queryId}.json`)),
      });
    }

    return { blockchain, admin, minter, alice, bob, outsider, collection, mint };
  }

  test('授权铸造单调 index 且所有者正确', async () => {
    const { blockchain, minter, alice, collection, mint } = await deployCollection();

    const first = await mint(1n, alice.address);
    expect(first.transactions).toHaveTransaction({ to: collection.address, success: true });
    expect(first.transactions).toHaveTransaction({ endStatus: 'active', success: true });

    await mint(2n, alice.address);

    const data = await collection.getGetCollectionData();
    expect(data.nextItemIndex).toBe(2n);

    // 两个 item 地址互异且与 collection 推导一致；当前所有者与 index 正确
    const item0 = blockchain.openContract(await NftItem.fromInit(collection.address, 0n));
    const item1 = blockchain.openContract(await NftItem.fromInit(collection.address, 1n));
    expect(item0.address.equals(await collection.getGetNftAddressByIndex(0n))).toBe(true);
    expect(item1.address.equals(await collection.getGetNftAddressByIndex(1n))).toBe(true);

    const item0Data = await item0.getGetNftData();
    expect(item0Data.index).toBe(0n);
    expect(item0Data.owner.equals(alice.address)).toBe(true);
    expect(item0Data.collection.equals(collection.address)).toBe(true);

    const item1Data = await item1.getGetNftData();
    expect(item1Data.index).toBe(1n);
    expect(item1Data.owner.equals(alice.address)).toBe(true);
  });

  test('非授权铸造被拒绝', async () => {
    const { outsider, collection, mint } = await deployCollection();

    const result = await outsider.send({
      to: collection.address,
      value: toNano('0.1'),
      body: mintBody(10n, outsider.address, tep64Content('https://caishenye.net/ton/item-x.json')),
    });
    expect(result.transactions).toHaveTransaction({ to: collection.address, success: false });

    const data = await collection.getGetCollectionData();
    expect(data.nextItemIndex).toBe(0n);
    expect(result.transactions).toHaveTransaction({ to: collection.address });
  });

  test('转移后 item 地址稳定且当前所有者更新', async () => {
    const { blockchain, minter, alice, bob, collection, mint } = await deployCollection();

    await mint(20n, alice.address);
    const addressBefore = await collection.getGetNftAddressByIndex(0n);
    const item = blockchain.openContract(await NftItem.fromInit(collection.address, 0n));
    expect((await item.getGetNftData()).owner.equals(alice.address)).toBe(true);

    // 非所有者转移被拒
    const reject = await bob.send({
      to: item.address,
      value: toNano('0.1'),
      body: transferBody(21n, bob.address),
    });
    expect(reject.transactions).toHaveTransaction({ to: item.address, success: false });
    expect((await item.getGetNftData()).owner.equals(alice.address)).toBe(true);

    // 所有者转移：所有者更新，地址（collection+index 推导）不变
    const transfer = await alice.send({
      to: item.address,
      value: toNano('0.1'),
      body: transferBody(22n, bob.address),
    });
    expect(transfer.transactions).toHaveTransaction({ to: item.address, success: true });

    const addressAfter = await collection.getGetNftAddressByIndex(0n);
    expect(addressAfter.equals(addressBefore)).toBe(true);
    const data = await item.getGetNftData();
    expect(data.owner.equals(bob.address)).toBe(true);
    expect(data.index).toBe(0n);

    // 转移后新铸造仍单调：index 不与既有重复
    await mint(23n, alice.address);
    expect((await collection.getGetCollectionData()).nextItemIndex).toBe(2n);
    expect((await collection.getGetNftAddressByIndex(1n)).equals(addressAfter)).toBe(false);
  });

  test('钱包可识别 metadata（TEP-64 内容 Cell）', async () => {
    const { blockchain, minter, alice, collection, mint } = await deployCollection();

    const uri = 'https://caishenye.net/ton/item-30.json';
    await minter.send({
      to: collection.address,
      value: toNano('0.2'),
      body: mintBody(30n, alice.address, tep64Content(uri)),
    });

    const item = blockchain.openContract(await NftItem.fromInit(collection.address, 0n));
    const data = await item.getGetNftData();
    const slice = data.content.beginParse();
    expect(slice.loadUint(8)).toBe(1);
    expect(slice.loadStringTail()).toBe(uri);

    const collectionData = await collection.getGetCollectionData();
    const cSlice = collectionData.collectionContent.beginParse();
    expect(cSlice.loadUint(8)).toBe(1);
    expect(cSlice.loadStringTail()).toBe('https://caishenye.net/ton/collection.json');
  });
});

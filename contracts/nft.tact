// 签文 NFT Collection / Item（TEP-62）——add-ton-chain-support 3.1 骨架。
// 3.3 完善面：主业务合约授权铸造、单调 item index 分配、metadata 指向按链与
// 部署隔离的 NFT metadata 接口、钱包可识别 metadata 的用例。

message(0x5fcc3d14) NFTTransfer {
    queryId: Int as uint64;
    newOwner: Address;
    responseDestination: Address?;
    forwardAmount: Int as coins;
    forwardPayload: Slice as remaining;
}

message(0x0f8a7ea5) MintNFT {
    queryId: Int as uint64;
    toOwner: Address;
    metadata: Cell;
}

contract NftCollection {
    owner: Address;
    nextItemIndex: Int as uint64;
    collectionContent: Cell;
    nftItemCode: Cell;

    init(owner: Address, collectionContent: Cell) {
        self.owner = owner;
        self.nextItemIndex = 0;
        self.collectionContent = collectionContent;
        self.nftItemCode = initOf NftItem(owner, myAddress(), 0, emptyCell()).code;
    }

    // 授权铸造（3.3 完善）：index 单调分配、仅主业务合约可铸、item 地址按
    // (collection, index) 推导。
    receive(msg: MintNFT) {
        require(context().sender == self.owner, "Unauthorized mint");

        send(SendParameters {
            to: self.itemAddress(self.nextItemIndex),
            value: 0,
            bounce: false,
            code: initOf NftItem(msg.toOwner, myAddress(), self.nextItemIndex, msg.metadata).code,
            data: initOf NftItem(msg.toOwner, myAddress(), self.nextItemIndex, msg.metadata).data,
            body: NftExcesses { queryId: msg.queryId }.toCell(),
        });
        self.nextItemIndex = self.nextItemIndex + 1;
    }

    fun itemAddress(index: Int): Address {
        return contractAddress(initOf NftItem(self.owner, myAddress(), index, emptyCell()));
    }

    get fun get_collection_data(): CollectionData {
        return CollectionData {
            nextItemIndex: self.nextItemIndex,
            collectionContent: self.collectionContent,
            owner: self.owner,
        };
    }

    get fun get_nft_address_by_index(index: Int): Address {
        return self.itemAddress(index);
    }
}

contract NftItem {
    owner: Address;
    collection: Address;
    index: Int as uint64;
    metadata: Cell;

    init(owner: Address, collection: Address, index: Int, metadata: Cell) {
        self.owner = owner;
        self.collection = collection;
        self.index = index;
        self.metadata = metadata;
    }

    receive(msg: NFTTransfer) {
        require(context().sender == self.owner, "Unauthorized transfer");
        self.owner = msg.newOwner;
        // forward payload 的标准转发与 excess 退回（3.3 按真实 trace 校正）
        send(SendParameters {
            to: msg.newOwner,
            value: 0,
            bounce: false,
            body: OwnershipTransferred { queryId: msg.queryId }.toCell(),
        });
        self.cashback(msg.responseDestination);
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, bounce: false, body: NftExcesses { queryId: 0 }.toCell() });
        }
    }

    get fun get_nft_data(): NftData {
        return NftData {
            index: self.index,
            collection: self.collection,
            owner: self.owner,
            content: self.metadata,
        };
    }
}

message OwnershipTransferred {
    queryId: Int as uint64;
}

message NftExcesses {
    queryId: Int as uint64;
}

struct CollectionData {
    nextItemIndex: Int;
    collectionContent: Cell;
    owner: Address;
}

struct NftData {
    index: Int;
    collection: Address;
    owner: Address;
    content: Cell;
}

// 签文 NFT Collection / Item（TEP-62）——add-ton-chain-support 3.3。
// 设计定案（design D4/D3）：授权铸造 = admin + minter（主业务合约）；item index
// 由 Collection 单调分配（重复 index 在结构上不可能）；item StateInit 只含
// (collection, index)——owner/content 走部署消息体，保证 get_nft_address_by_index
// 在转移后地址不变（钱包按 collection+index 推导Item 地址的 TEP-62 前提）；
// metadata 为 TEP-64 内容 Cell，指向按链与部署隔离的 NFT metadata 接口（3.8 清单）。

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

message(0x7bdd97de) NftExcesses {
    queryId: Int as uint64;
}

// 部署消息体：仅 Collection 可发，覆写 owner/content（StateInit 不含它们）。
message InitNftItem {
    owner: Address;
    content: Cell;
}

message OwnershipTransferred {
    queryId: Int as uint64;
}

contract NftCollection {
    owner: Address;
    minter: Address;
    nextItemIndex: Int as uint64;
    collectionContent: Cell;
    nftItemCode: Cell;

    init(owner: Address, minter: Address, collectionContent: Cell) {
        self.owner = owner;
        self.minter = minter;
        self.nextItemIndex = 0;
        self.collectionContent = collectionContent;
        self.nftItemCode = initOf NftItem(myAddress(), 0).code;
    }

    // 空消息接收：部署与普通转账不抛错
    receive() {}

    receive(msg: NftExcesses) {
        self.cashback(sender());
    }

    // 授权铸造：index 单调分配；item 以 (collection, index) StateInit 部署，
    // owner/content 经 InitNftItem 消息体覆写。
    receive(msg: MintNFT) {
        require(self.isAuthorizedMinter(context().sender), "Unauthorized mint");

        send(SendParameters {
            to: self.itemAddress(self.nextItemIndex),
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            bounce: false,
            code: initOf NftItem(myAddress(), self.nextItemIndex).code,
            data: initOf NftItem(myAddress(), self.nextItemIndex).data,
            body: InitNftItem {
                owner: msg.toOwner,
                content: msg.metadata,
            }.toCell(),
        });
        self.nextItemIndex = self.nextItemIndex + 1;
    }

    fun isAuthorizedMinter(sender: Address): Bool {
        return sender == self.owner || sender == self.minter;
    }

    fun itemAddress(index: Int): Address {
        return contractAddress(initOf NftItem(myAddress(), index));
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, mode: SendPayGasSeparately, bounce: false, body: NftExcesses{ queryId: 0 }.toCell() });
        }
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
    content: Cell;

    init(collection: Address, index: Int) {
        self.owner = collection;
        self.collection = collection;
        self.index = index;
        self.content = emptyCell();
    }

    // 部署初始化：仅 Collection 可发（design D4：只有授权主业务合约能铸造）
    receive(msg: InitNftItem) {
        require(context().sender == self.collection, "Unauthorized item init");
        self.owner = msg.owner;
        self.content = msg.content;
    }

    receive(msg: NFTTransfer) {
        require(context().sender == self.owner, "Unauthorized transfer");
        self.owner = msg.newOwner;
        // 标准转移：告知新所有者（forwardPayload 语义由 3.7 消息流测试校正）
        if (msg.forwardAmount > 0) {
            send(SendParameters {
                to: msg.newOwner,
                value: 0,
                mode: SendPayGasSeparately,
                bounce: false,
                body: OwnershipTransferred { queryId: msg.queryId }.toCell(),
            });
        }
        self.cashback(msg.responseDestination);
    }

    receive(msg: NftExcesses) {
        self.cashback(sender());
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: 0, mode: SendPayGasSeparately, bounce: false, body: NftExcesses{ queryId: 0 }.toCell() });
        }
    }

    get fun get_nft_data(): NftData {
        return NftData {
            index: self.index,
            collection: self.collection,
            owner: self.owner,
            content: self.content,
        };
    }
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

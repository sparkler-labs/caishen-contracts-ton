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

message(0x25d1b7f9) MintNFT {
    queryId: Int as uint64;
    toOwner: Address;
    metadata: Cell;
}

// 铸造回执：item 部署完成（design D5 状态机——business 据此置 state=已铸）
message ItemDeployed {
    queryId: Int as uint64;
    itemIndex: Int as uint64;
    stickNo: Int as uint8;
}

message(0x7bdd97de) NftExcesses {
    queryId: Int as uint64;
}

// 部署消息体：仅 Collection 可发，覆写 owner/content/stickNo（StateInit 不含它们）。
message InitNftItem {
    owner: Address;
    content: Cell;
    stickNo: Int as uint8;
}

message OwnershipTransferred {
    queryId: Int as uint64;
}

// minter 登记（与 JettonMaster SetMinter 同构）：owner 部署后一次性登记主业务合约。
message SetNftMinter {
    minter: Address;
}

contract NftCollection {
    owner: Address;
    minter: Address?;
    nextItemIndex: Int as uint64;
    collectionContent: Cell;
    nftItemCode: Cell;
    // 对 (minter, query_id) 幂等（design D5：同一消耗至多一枚 NFT；单 collection
    // 单 minter，query_id 键足够）——resume 重发铸造命令时拦住重复部署
    processedMints: map<Int as uint64, Bool>;

    init(owner: Address, collectionContent: Cell) {
        self.owner = owner;
        self.minter = null;
        self.nextItemIndex = 0;
        self.collectionContent = collectionContent;
        self.nftItemCode = initOf NftItem(myAddress(), 0).code;
        self.processedMints = emptyMap();
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
        // (minter, query_id) 幂等：重复铸造命令（resume 重发）不重复部署
        require(self.processedMints.get(msg.queryId) == null, "Duplicate mint query id");

        // 签号（design D4，EVM 事后确定式伪随机同语义）：
        // hash(collection + item index + 原求签者 + 铸造时间) % 60 + 1，铸造时间
        // 为本交易时刻；持久化进 item 业务数据（后端 4.4 从 get-method 核对）
        let stickNo: Int = (beginCell()
            .storeAddress(myAddress())
            .storeUint(self.nextItemIndex, 64)
            .storeAddress(msg.toOwner)
            .storeUint(now(), 64)
            .endCell().hash() % 60) + 1;

        self.processedMints.set(msg.queryId, true);
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
                stickNo: stickNo,
            }.toCell(),
        });

        // 部署回执给 minter（business 状态机推进）
        if (self.minter != null) {
            send(SendParameters {
                to: self.minter!!,
                value: ton("0.05"),
                mode: SendPayGasSeparately,
                bounce: false,
                body: ItemDeployed {
                    queryId: msg.queryId,
                    itemIndex: self.nextItemIndex,
                    stickNo: stickNo,
                }.toCell(),
            });
        }
        self.nextItemIndex = self.nextItemIndex + 1;
    }

    // 主业务合约登记（一次性）：business 的 init 含 collection 地址，collection
    // 的 minter 含 business 地址，后置登记打破循环。
    receive(msg: SetNftMinter) {
        require(context().sender == self.owner, "Unauthorized minter setup");
        require(self.minter == null, "Minter has been set");
        self.minter = msg.minter;
    }

    fun isAuthorizedMinter(sender: Address): Bool {
        return sender == self.owner || (self.minter != null && sender == self.minter!!);
    }

    fun itemAddress(index: Int): Address {
        return contractAddress(initOf NftItem(myAddress(), index));
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: ton("0.05"), mode: SendPayGasSeparately, bounce: false, body: NftExcesses{ queryId: 0 }.toCell() });
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
    stickNo: Int as uint8;

    init(collection: Address, index: Int) {
        self.owner = collection;
        self.collection = collection;
        self.index = index;
        self.content = emptyCell();
        self.stickNo = 0;
    }

    // 部署初始化：仅 Collection 可发（design D4：只有授权主业务合约能铸造）
    receive(msg: InitNftItem) {
        require(context().sender == self.collection, "Unauthorized item init");
        self.owner = msg.owner;
        self.content = msg.content;
        self.stickNo = msg.stickNo;
    }

    receive(msg: NFTTransfer) {
        require(context().sender == self.owner, "Unauthorized transfer");
        self.owner = msg.newOwner;
        // 标准转移：告知新所有者（forwardPayload 语义由 3.7 消息流测试校正）
        if (msg.forwardAmount > 0) {
            send(SendParameters {
                to: msg.newOwner,
                value: ton("0.05"),
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
            send(SendParameters { to: to!!, value: ton("0.05"), mode: SendPayGasSeparately, bounce: false, body: NftExcesses{ queryId: 0 }.toCell() });
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

    // 签号（design D4：合约内确定并持久化，后端从 get-method 核对）
    get fun get_stick_no(): Int {
        return self.stickNo;
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

// 上香/求签主业务合约——add-ton-chain-support 3.1 骨架。
// 3.4–3.6 完善面（design D5）：
// - 上香：带 query_id 付款消息 → 校验价格/每日次数/供应 → 向 Jetton Master 发铸造
// - 求签：Jetton transfer notification 验证（仅接受登记 Master 推导的钱包）→
//   8 MERIT 消耗 → 登记 draw_requests → 向 Collection 发铸造命令
// - resume_draw(query_id)：已消耗未铸造的恢复，不重复扣费；Collection 对
//   (business, query_id) 幂等
// - 签号：hash(collection + item index + 原求签者 + 铸造时间) % 60 + 1，合约内计算

message IncensePayment {
    queryId: Int as uint64;
}

message DrawRequestMessage {
    queryId: Int as uint64;
}

message ResumeDraw {
    queryId: Int as uint64;
}

struct DrawRequest {
    requester: Address;
    itemIndex: Int as uint64;
    state: Int as uint8;
}

contract IncenseDraw {
    // 部署清单（3.8）登记的关联合约
    admin: Address;
    jettonMaster: Address;
    nftCollection: Address;

    // 规则参数（3.4 按 EVM 版业务规则对齐）
    incensePrice: Int as coins;
    maxSupply: Int as uint32;
    totalIncense: Int as uint32;

    // 求签幂等登记：query_id → 请求（state: 0=已登记 1=已消耗 2=已铸造）
    drawRequests: map<Int as uint64, DrawRequest>;

    init(admin: Address, jettonMaster: Address, nftCollection: Address, incensePrice: Int, maxSupply: Int) {
        self.admin = admin;
        self.jettonMaster = jettonMaster;
        self.nftCollection = nftCollection;
        self.incensePrice = incensePrice;
        self.maxSupply = maxSupply;
        self.totalIncense = 0;
    }

    // 空消息接收：部署与普通转账不抛错（3.1 骨架）
    receive() {}

    // 上香付款（3.4 落地：价格/每日次数/供应/奖励衰减校验 + Jetton 发放）
    receive(msg: IncensePayment) {
        require(context().value >= self.incensePrice, "Insufficient payment");
        require(self.totalIncense < self.maxSupply, "Supply exhausted");
        // TODO(3.4): 每日次数与奖励序列校验、超额退回、Jetton 铸造消息、
        // query_id 幂等与 bounce/excess 语义
        self.totalIncense = self.totalIncense + 1;
    }

    // 求签消耗登记（3.5 落地：Jetton notification 来源验证）
    receive(msg: DrawRequestMessage) {
        require(self.drawRequests.get(msg.queryId) == null, "Duplicate query id");
        // TODO(3.5): 仅接受由登记 Jetton Master 推导的用户钱包的 notification，
        // 8 MERIT 消耗验证、绝不信任自报 sender
        self.drawRequests.set(msg.queryId, DrawRequest {
            requester: context().sender,
            itemIndex: 0,
            state: 0,
        });
    }

    // 恢复（3.6 落地：已消耗未铸造 → 重新触发铸造，不重复扣 MERIT）
    receive(msg: ResumeDraw) {
        // TODO(3.6): 请求存在且 state==已消耗、仅登记请求者可触发、
        // 签号在合约内确定并写入 NFT 业务数据
        require(self.drawRequests.get(msg.queryId) != null, "Unknown query id");
    }

    get fun incense_price(): Int {
        return self.incensePrice;
    }

    get fun total_incense(): Int {
        return self.totalIncense;
    }

    get fun draw_request(queryId: Int): DrawRequest? {
        return self.drawRequests.get(queryId);
    }

    get fun contract_config(): ContractConfig {
        return ContractConfig {
            admin: self.admin,
            jettonMaster: self.jettonMaster,
            nftCollection: self.nftCollection,
            maxSupply: self.maxSupply,
        };
    }
}

struct ContractConfig {
    admin: Address;
    jettonMaster: Address;
    nftCollection: Address;
    maxSupply: Int;
}

// 上香/求签主业务合约——add-ton-chain-support 3.4（上香规则落地）。
// 规则逐条对齐 EVM 版 CyberFortuneGod.offeringIncense：
// - 付款 >= mintPrice；每用户每日至多 3 次；当日全局第 1–4 次铸 88/66/36/30 MERIT，
//   之后按 lastDecrement * 10^decimals / decreaseCoefficient 衰减
// - 每日供应重置：当日首笔铸时 remainingSupply = totalSupplyByDay（EVM updateSupplyByDay 语义）
// - returns > 0 才成立；发放 TON 版 MERIT（JettonMaster.mint，本合约即其 minter）
// - design D5：query_id 幂等（重复拒绝并经 bounce 退回）、excess 退回
// 求签（3.5）与 resume_draw（3.6）在后续任务落地。

import "./jetton";
import "./nft";

message(0x7bdd97de) BizExcesses {
    queryId: Int as uint64;
}

message IncensePayment {
    queryId: Int as uint64;
}

// 求签恢复（design D5）：仅登记请求者可触发，不再次扣 MERIT
message ResumeDraw {
    queryId: Int as uint64;
}

contract IncenseDraw {
    // 部署清单（3.8）登记的关联合约
    admin: Address;
    jettonMaster: Address;
    nftCollection: Address;

    // 规则参数（EVM CyberFortuneGod.initialize 同形）
    decimals: Int as uint8;
    startTime: Int;
    decreaseCoefficient: Int;
    totalSupplyByDay: Int as coins;
    mintPrice: Int as coins;

    // 每日状态（当日重置）
    currentDay: Int;
    remainingSupply: Int as coins;
    lastDecrement: Int as coins;
    dayMintNum: Int as uint32;

    // 每用户每日次数：值 = day * 4 + count（count <= 3），day 不符即视为 0
    userDayMint: map<Address, Int>;

    // 上香 query_id 幂等（design D6：chain + deployment + query_id + operation）
    processedIncense: map<Int as uint64, Bool>;

    // 求签（3.5/3.6，design D5）：query_id → {requester, itemIndex, state}
    // state：0=已消耗铸造待确认（可 resume）1=已铸造（ItemDeployed 回执确认）
    drawRequests: map<Int as uint64, DrawRequest>;
    // 求签 MERIT 金库：8 MERIT 消耗移入（EVM 版为 burn，TON 版金库化——
    // 消耗离源语义等价，销毁机制由 3.7/3.8 演练定案）
    drawTreasury: Int as coins;
    drawCount: Int as uint64;

    init(admin: Address, jettonMaster: Address, nftCollection: Address, decimals: Int, startTime: Int, decreaseCoefficient: Int, totalSupplyByDay: Int, mintPrice: Int) {
        self.admin = admin;
        self.jettonMaster = jettonMaster;
        self.nftCollection = nftCollection;
        self.decimals = decimals;
        self.startTime = startTime;
        self.decreaseCoefficient = decreaseCoefficient;
        self.totalSupplyByDay = totalSupplyByDay;
        self.mintPrice = mintPrice;
        self.currentDay = 0;
        self.remainingSupply = 0;
        self.lastDecrement = 0;
        self.dayMintNum = 0;
        self.drawTreasury = 0;
        self.drawCount = 0;
    }

    // 空消息接收：普通转账不抛错
    receive() {}

    receive(msg: BizExcesses) {
        self.cashback(sender());
    }

    // EVM getDays 语义：按 startTime 起算的自然日序号
    fun currentDayNum(): Int {
        return (now() - self.startTime) / 86400;
    }

    fun userMintCountToday(sender: Address, day: Int): Int {
        let storedOpt: Int? = self.userDayMint.get(sender);
        if (storedOpt == null) {
            return 0;
        }
        let stored: Int = storedOpt!!;
        if (stored / 4 == day) {
            return stored % 4;
        }
        return 0;
    }

    // EVM getMintAmount 同形：全局每日序列 88/66/36/30 → 衰减，受每日供应截断
    fun mintAmount(): Int {
        if (self.remainingSupply == 0) {
            return 0;
        }
        let unit: Int = pow(10, self.decimals);
        // firstMintByDay/secondMintByDay/thirdMintByDay/fourthMintByDay = 88/66/36/30
        let top4: Int = self.dayMintNum < 1 ? 88 : (self.dayMintNum < 2 ? 66 : (self.dayMintNum < 3 ? 36 : 30));
        let returns: Int = self.dayMintNum < 4 ? unit * top4 : (self.lastDecrement * unit) / self.decreaseCoefficient;
        if (returns >= self.remainingSupply) {
            returns = self.remainingSupply;
            self.remainingSupply = 0;
        } else {
            self.remainingSupply = self.remainingSupply - returns;
        }
        self.lastDecrement = returns;
        if (returns > 0) {
            self.dayMintNum = self.dayMintNum + 1;
        }
        return returns;
    }

    // 上香付款：规则校验 → Jetton 发放 → 幂等登记 → excess 退回
    receive(msg: IncensePayment) {
        let sender: Address = context().sender;
        let value: Int = context().value;
        let day: Int = self.currentDayNum();

        require(value >= self.mintPrice, "Payment amount is insufficient");
        require(day >= 0, "Contract not started");

        let count: Int = self.userMintCountToday(sender, day);
        require(count < 3, "Mint up to three times a day");
        require(self.processedIncense.get(msg.queryId) == null, "Duplicate query id");

        // 当日首次：重置每日供应（EVM updateSupplyByDay 语义）
        if (day != self.currentDay) {
            self.currentDay = day;
            self.remainingSupply = self.totalSupplyByDay;
            self.lastDecrement = 0;
            self.dayMintNum = 0;
        }

        let returns: Int = self.mintAmount();
        require(returns > 0, "Today's MERIT has been distributed out");

        self.userDayMint.set(sender, day * 4 + count + 1);
        self.processedIncense.set(msg.queryId, true);

        // Jetton 发放：本合约是 JettonMaster 登记的 minter（3.2）
        send(SendParameters {
            to: self.jettonMaster,
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: Mint {
                queryId: msg.queryId,
                receiver: sender,
                amount: returns,
            }.toCell(),
        });

        // excess 退回：gas 预留 0.01 TON，其余超付退回付款人（design D5）
        let excess: Int = value - self.mintPrice - ton("0.01");
        if (excess > 0) {
            send(SendParameters {
                to: sender,
                value: excess,
                mode: SendPayGasSeparately,
                bounce: false,
                body: BizExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    fun cashback(to: Address?) {
        if (to != null) {
            send(SendParameters { to: to!!, value: ton("0.05"), mode: SendPayGasSeparately, bounce: false, body: BizExcesses{ queryId: 0 }.toCell() });
        }
    }

    // 求签消耗：8 MERIT（EVM drawFortune 同额）
    fun drawCost(): Int {
        return 8 * pow(10, self.decimals);
    }

    // 仅接受由登记 Jetton Master 推导的用户 Jetton Wallet（design D5：
    // 绝不信任消息自报 sender——msg.from 必须能推导出实际 sender）
    fun masterWalletAddress(owner: Address): Address {
        return contractAddress(initOf JettonWallet(owner, self.jettonMaster));
    }

    // 求签入口：用户 Jetton Wallet 的 TokenTransferInternal 到达
    // （forwardPayload = queryId as uint64），验证 → 消耗登记 → NFT 铸造命令
    receive(msg: TokenTransferInternal) {
        require(context().sender == self.masterWalletAddress(msg.from), "Unauthorized draw source");
        require(msg.amount >= self.drawCost(), "Insufficient MERIT for draw");

        let queryId: Int = msg.forwardPayload.loadUint(64);
        require(self.drawRequests.get(queryId) == null, "Duplicate draw query id");

        self.drawTreasury = self.drawTreasury + msg.amount;
        let itemIndex: Int = self.drawCount;
        self.drawCount = self.drawCount + 1;
        self.drawRequests.set(queryId, DrawRequest {
            requester: msg.from,
            itemIndex: itemIndex,
            state: 0,
        });

        // NFT 铸造命令：本合约 = Collection 的 minter（3.3）；item content 空 Cell
        // —— TEP-62 惯例，钱包回退到 collection content + index（metadata 接口 3.8 接线）
        send(SendParameters {
            to: self.nftCollection,
            value: ton("0.1"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: MintNFT {
                queryId: queryId,
                toOwner: msg.from,
                metadata: emptyCell(),
            }.toCell(),
        });
    }

    // 铸造回执：状态推进到已铸（仅信任登记 Collection 的消息）
    receive(msg: ItemDeployed) {
        require(context().sender == self.nftCollection, "Unauthorized deploy receipt");
        let stored: DrawRequest? = self.drawRequests.get(msg.queryId);
        require(stored != null, "Unknown deploy receipt");
        let request: DrawRequest = stored!!;
        require(request.itemIndex == msg.itemIndex, "Item index mismatch");
        self.drawRequests.set(msg.queryId, DrawRequest {
            requester: request.requester,
            itemIndex: request.itemIndex,
            state: 1,
        });
    }

    // resume_draw（design D5）：已消耗铸造未确认时，仅登记请求者可重发铸造命令；
    // 不再次扣 MERIT；Collection 对 query_id 幂等，重复恢复至多一枚 NFT
    receive(msg: ResumeDraw) {
        let stored: DrawRequest? = self.drawRequests.get(msg.queryId);
        require(stored != null, "Unknown draw request");
        let request: DrawRequest = stored!!;
        require(context().sender == request.requester, "Only the requester can resume");
        require(request.state == 0, "Draw already minted");

        send(SendParameters {
            to: self.nftCollection,
            value: ton("0.1"),
            mode: SendPayGasSeparately,
            bounce: false,
            body: MintNFT {
                queryId: msg.queryId,
                toOwner: request.requester,
                metadata: emptyCell(),
            }.toCell(),
        });
    }

    get fun draw_request(queryId: Int): DrawRequest? {
        return self.drawRequests.get(queryId);
    }

    get fun draw_treasury(): Int {
        return self.drawTreasury;
    }

    get fun draw_count(): Int {
        return self.drawCount;
    }

    get fun draw_cost(): Int {
        return self.drawCost();
    }

    get fun incense_price(): Int {
        return self.mintPrice;
    }

    get fun total_incense(): Int {
        return self.dayMintNum;
    }

    get fun remaining_supply(): Int {
        return self.remainingSupply;
    }

    get fun current_day(): Int {
        return self.currentDay;
    }

    get fun incense_processed(queryId: Int): Bool {
        let flag: Bool? = self.processedIncense.get(queryId);
        return flag != null && flag!!;
    }

    get fun user_mint_count_today(user: Address): Int {
        return self.userMintCountToday(user, self.currentDayNum());
    }

    get fun contract_config(): ContractConfig {
        return ContractConfig {
            admin: self.admin,
            jettonMaster: self.jettonMaster,
            nftCollection: self.nftCollection,
            decimals: self.decimals,
            mintPrice: self.mintPrice,
            totalSupplyByDay: self.totalSupplyByDay,
            decreaseCoefficient: self.decreaseCoefficient,
        };
    }
}

struct DrawRequest {
    requester: Address;
    itemIndex: Int as uint64;
    state: Int as uint8;
}

struct ContractConfig {
    admin: Address;
    jettonMaster: Address;
    nftCollection: Address;
    decimals: Int;
    mintPrice: Int;
    totalSupplyByDay: Int;
    decreaseCoefficient: Int;
}

use odra::prelude::*;
use odra::casper_types::U512;

/// Lifecycle state. `at_customs` / `delayed` are orthogonal flags on `InTransit`.
/// `#[odra::odra_type]` already derives PartialEq/Eq/Debug — do not add them.
#[odra::odra_type]
pub enum ShipmentStatus {
    Created,
    InTransit,
    Delivered,
    Lost,
    Settled,
}

/// Full shipment record. Holders/shares kept inline (demo holder count is small).
/// All monetary + quantity fields are native CSPR motes (U512): escrow is funded
/// with attached CSPR at tokenize and paid out via `transfer_tokens`.
#[odra::odra_type]
pub struct Shipment {
    pub id: u64,
    pub metadata: String,
    pub status: ShipmentStatus,
    pub quantity: U512,
    pub unit_price: U512,
    pub condition_score: u8, // 0..=100
    pub initial_value: U512,
    pub appraised_value: U512,
    pub escrow: U512,
    pub insurance_coverage: U512,
    pub at_customs: bool,
    pub delayed: bool,
    pub delay_penalty: U512,
    pub data_spend: U512,
    pub last_update: u64,
    pub holders: Vec<Address>,
    pub shares: Vec<U512>, // parallel to holders; sum = total shares
}

#[odra::odra_error]
pub enum Error {
    NotOwner = 40_000,
    NotOperator = 40_001,
    ShipmentNotFound = 40_002,
    InvalidStatus = 40_003,
    HoldersSharesMismatch = 40_004,
    BadConditionScore = 40_006,
}

#[odra::event]
pub struct ShipmentTokenized { pub id: u64, pub initial_value: U512, pub escrow: U512, pub holders: u32 }
#[odra::event]
pub struct Revalued { pub id: u64, pub old_value: U512, pub new_value: U512, pub reason_code: u8 }
#[odra::event]
pub struct DelayFlagged { pub id: u64, pub penalty: U512 }
#[odra::event]
pub struct CustomsUpdated { pub id: u64, pub at_customs: bool, pub location: String }
#[odra::event]
pub struct Delivered { pub id: u64 }
#[odra::event]
pub struct ProceedsDistributed { pub id: u64, pub total: U512 }
#[odra::event]
pub struct LossReported { pub id: u64 }
#[odra::event]
pub struct InsurancePaid { pub id: u64, pub total: U512 }
#[odra::event]
pub struct DataSpendRecorded { pub id: u64, pub amount: U512, pub cumulative: U512 }

#[odra::module(events = [ShipmentTokenized, Revalued, DelayFlagged, CustomsUpdated, Delivered, ProceedsDistributed, LossReported, InsurancePaid, DataSpendRecorded])]
pub struct Custodian {
    owner: Var<Address>,
    operator: Var<Address>,
    next_id: Var<u64>,
    shipments: Mapping<u64, Shipment>,
}

#[odra::module]
impl Custodian {
    pub fn init(&mut self, owner: Address, operator: Address) {
        self.owner.set(owner);
        self.operator.set(operator);
        self.next_id.set(0);
    }

    // ---- admin ----
    pub fn set_operator(&mut self, operator: Address) {
        self.assert_owner();
        self.operator.set(operator);
    }

    /// Tokenize a shipment. Caller (owner) attaches CSPR = escrow backing the asset.
    #[odra(payable)]
    pub fn tokenize_shipment(
        &mut self,
        metadata: String,
        quantity: U512,
        unit_price: U512,
        insurance_coverage: U512,
        holders: Vec<Address>,
        shares: Vec<U512>,
    ) -> u64 {
        self.assert_owner();
        if holders.len() != shares.len() || holders.is_empty() {
            self.env().revert(Error::HoldersSharesMismatch);
        }
        let value = quantity * unit_price;
        let escrow = self.env().attached_value();
        let id = self.next_id.get_or_default();
        self.next_id.set(id + 1);
        let now = self.env().get_block_time();
        let shipment = Shipment {
            id,
            metadata,
            status: ShipmentStatus::InTransit,
            quantity,
            unit_price,
            condition_score: 100,
            initial_value: value,
            appraised_value: value,
            escrow,
            insurance_coverage,
            at_customs: false,
            delayed: false,
            delay_penalty: U512::zero(),
            data_spend: U512::zero(),
            last_update: now,
            holders: holders.clone(),
            shares,
        };
        self.shipments.set(&id, shipment);
        self.env().emit_event(ShipmentTokenized { id, initial_value: value, escrow, holders: holders.len() as u32 });
        id
    }

    // ---- agent actions (operator-gated) ----
    pub fn revalue(&mut self, id: u64, new_unit_price: U512, new_condition_score: u8, reason_code: u8) {
        self.assert_operator();
        if new_condition_score > 100 { self.env().revert(Error::BadConditionScore); }
        let mut s = self.load(id);
        if s.status != ShipmentStatus::InTransit { self.env().revert(Error::InvalidStatus); }
        let old = s.appraised_value;
        s.unit_price = new_unit_price;
        s.condition_score = new_condition_score;
        Self::recompute(&mut s);
        s.last_update = self.env().get_block_time();
        let new = s.appraised_value;
        self.shipments.set(&id, s);
        self.env().emit_event(Revalued { id, old_value: old, new_value: new, reason_code });
    }

    pub fn flag_delay(&mut self, id: u64, penalty: U512) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::InTransit { self.env().revert(Error::InvalidStatus); }
        s.delayed = true;
        s.delay_penalty = s.delay_penalty + penalty;
        self.shipments.set(&id, s);
        self.env().emit_event(DelayFlagged { id, penalty });
    }

    pub fn set_customs(&mut self, id: u64, at_customs: bool, location: String) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::InTransit { self.env().revert(Error::InvalidStatus); }
        s.at_customs = at_customs;
        self.shipments.set(&id, s);
        self.env().emit_event(CustomsUpdated { id, at_customs, location });
    }

    pub fn confirm_delivery(&mut self, id: u64) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::InTransit { self.env().revert(Error::InvalidStatus); }
        s.status = ShipmentStatus::Delivered;
        s.last_update = self.env().get_block_time();
        self.shipments.set(&id, s);
        self.env().emit_event(Delivered { id });
    }

    pub fn distribute(&mut self, id: u64) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::Delivered { self.env().revert(Error::InvalidStatus); }
        let total = if s.appraised_value > s.escrow { s.escrow } else { s.appraised_value };
        self.payout(&s, total);
        s.escrow = s.escrow - total;
        s.status = ShipmentStatus::Settled;
        self.shipments.set(&id, s);
        self.env().emit_event(ProceedsDistributed { id, total });
    }

    pub fn report_loss(&mut self, id: u64) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::InTransit { self.env().revert(Error::InvalidStatus); }
        s.status = ShipmentStatus::Lost;
        s.last_update = self.env().get_block_time();
        self.shipments.set(&id, s);
        self.env().emit_event(LossReported { id });
    }

    pub fn trigger_insurance(&mut self, id: u64) {
        self.assert_operator();
        let mut s = self.load(id);
        if s.status != ShipmentStatus::Lost { self.env().revert(Error::InvalidStatus); }
        let total = if s.insurance_coverage > s.escrow { s.escrow } else { s.insurance_coverage };
        self.payout(&s, total);
        s.escrow = s.escrow - total;
        s.status = ShipmentStatus::Settled;
        self.shipments.set(&id, s);
        self.env().emit_event(InsurancePaid { id, total });
    }

    pub fn record_data_spend(&mut self, id: u64, amount: U512) {
        self.assert_operator();
        let mut s = self.load(id);
        s.data_spend = s.data_spend + amount;
        let cumulative = s.data_spend;
        self.shipments.set(&id, s);
        self.env().emit_event(DataSpendRecorded { id, amount, cumulative });
    }

    // ---- reads ----
    pub fn get_shipment(&self, id: u64) -> Shipment { self.load(id) }
    pub fn get_status(&self, id: u64) -> ShipmentStatus { self.load(id).status }
    pub fn get_value(&self, id: u64) -> U512 { self.load(id).appraised_value }
    pub fn get_data_spend(&self, id: u64) -> U512 { self.load(id).data_spend }

    // ---- internal helpers ----
    fn load(&self, id: u64) -> Shipment {
        self.shipments.get(&id).unwrap_or_revert_with(self, Error::ShipmentNotFound)
    }
    fn assert_owner(&self) {
        let owner = self.owner.get().unwrap_or_revert_with(self, Error::NotOwner);
        if self.env().caller() != owner {
            self.env().revert(Error::NotOwner);
        }
    }
    fn assert_operator(&self) {
        let operator = self.operator.get().unwrap_or_revert_with(self, Error::NotOperator);
        if self.env().caller() != operator {
            self.env().revert(Error::NotOperator);
        }
    }
    fn recompute(s: &mut Shipment) {
        s.appraised_value =
            s.quantity * s.unit_price * U512::from(s.condition_score as u64) / U512::from(100u64);
    }

    /// Pro-rata native-CSPR transfer of `total` to holders by share weight.
    fn payout(&mut self, s: &Shipment, total: U512) {
        if total.is_zero() { return; }
        let mut total_shares = U512::zero();
        for w in s.shares.iter() { total_shares = total_shares + *w; }
        for (i, holder) in s.holders.iter().enumerate() {
            let amount = total * s.shares[i] / total_shares;
            if !amount.is_zero() {
                self.env().transfer_tokens(holder, &amount);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use odra::host::{Deployer, HostRef};
    use odra::casper_types::U512;

    const ESCROW: u64 = 100_000_000_000; // 100 CSPR
    const QTY: u64 = 1000;
    const PRICE: u64 = 100_000_000;       // qty*price = 100 CSPR
    const INSURANCE: u64 = 80_000_000_000; // 80 CSPR

    struct Ctx {
        env: odra::host::HostEnv,
        custodian: CustodianHostRef,
        owner: Address,
        operator: Address,
        alice: Address,
        bob: Address,
    }

    fn setup() -> Ctx {
        let env = odra_test::env();
        let owner = env.get_account(0);
        let operator = env.get_account(1);
        let alice = env.get_account(2);
        let bob = env.get_account(3);
        let custodian = Custodian::deploy(&env, CustodianInitArgs { owner, operator });
        Ctx { env, custodian, owner, operator, alice, bob }
    }

    /// Tokenize a shipment with alice 60% / bob 40%, attaching ESCROW CSPR.
    fn tokenize(c: &mut Ctx) -> u64 {
        c.custodian.env().set_caller(c.owner);
        c.custodian
            .with_tokens(U512::from(ESCROW))
            .tokenize_shipment(
                "Coffee Santos->Rotterdam".to_string(),
                U512::from(QTY),
                U512::from(PRICE),
                U512::from(INSURANCE),
                vec![c.alice, c.bob],
                vec![U512::from(60u64), U512::from(40u64)],
            )
    }

    #[test]
    fn tokenize_creates_intransit_shipment() {
        let mut c = setup();
        let id = tokenize(&mut c);
        let s = c.custodian.get_shipment(id);
        assert_eq!(s.status, ShipmentStatus::InTransit);
        assert_eq!(s.appraised_value, U512::from(ESCROW));
        assert_eq!(s.escrow, U512::from(ESCROW));
        assert_eq!(s.condition_score, 100u8);
        assert_eq!(s.holders.len(), 2);
        // contract purse now holds the escrow
        assert_eq!(c.env.balance_of(&c.custodian), U512::from(ESCROW));
        assert!(c.env.emitted_event(&c.custodian, ShipmentTokenized {
            id, initial_value: U512::from(ESCROW), escrow: U512::from(ESCROW), holders: 2,
        }));
    }

    #[test]
    fn tokenize_rejects_mismatched_holders_shares() {
        let mut c = setup();
        c.custodian.env().set_caller(c.owner);
        let res = c.custodian.with_tokens(U512::from(ESCROW)).try_tokenize_shipment(
            "x".to_string(), U512::from(1u64), U512::from(1u64), U512::from(0u64),
            vec![c.alice], vec![U512::from(1u64), U512::from(1u64)],
        );
        assert!(res.is_err());
    }

    #[test]
    fn non_owner_cannot_tokenize() {
        let mut c = setup();
        c.custodian.env().set_caller(c.alice);
        let res = c.custodian.with_tokens(U512::from(ESCROW)).try_tokenize_shipment(
            "x".to_string(), U512::from(1u64), U512::from(1u64), U512::from(0u64),
            vec![c.alice], vec![U512::from(1u64)],
        );
        assert!(res.is_err());
    }

    #[test]
    fn operator_revalues_down_on_breach() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        c.custodian.revalue(id, U512::from(PRICE), 70, 1);
        let s = c.custodian.get_shipment(id);
        assert_eq!(s.condition_score, 70u8);
        // 1000 * 100_000_000 * 70 / 100 = 70_000_000_000
        assert_eq!(s.appraised_value, U512::from(70_000_000_000u64));
        assert!(c.env.emitted_event(&c.custodian, Revalued {
            id, old_value: U512::from(ESCROW), new_value: U512::from(70_000_000_000u64), reason_code: 1,
        }));
    }

    #[test]
    fn non_operator_cannot_revalue() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.alice);
        let res = c.custodian.try_revalue(id, U512::from(1u64), 50, 0);
        assert!(res.is_err());
    }

    #[test]
    fn revalue_rejects_bad_condition_score() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        let res = c.custodian.try_revalue(id, U512::from(1u64), 101, 0);
        assert!(res.is_err());
    }

    #[test]
    fn operator_flags_delay_and_customs() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        c.custodian.flag_delay(id, U512::from(500u64));
        c.custodian.set_customs(id, true, "Rotterdam Port".to_string());
        let s = c.custodian.get_shipment(id);
        assert!(s.delayed);
        assert_eq!(s.delay_penalty, U512::from(500u64));
        assert!(s.at_customs);
    }

    #[test]
    fn delivery_distributes_proceeds_prorata() {
        let mut c = setup();
        let id = tokenize(&mut c); // escrow 100 CSPR, alice 60 / bob 40, value 100 CSPR
        c.custodian.env().set_caller(c.operator);
        c.custodian.revalue(id, U512::from(PRICE), 70, 1); // breach -> 70 CSPR
        c.custodian.confirm_delivery(id);
        let alice_before = c.env.balance_of(&c.alice);
        let bob_before = c.env.balance_of(&c.bob);
        c.custodian.distribute(id);
        let s = c.custodian.get_shipment(id);
        assert_eq!(s.status, ShipmentStatus::Settled);
        // 70 CSPR split 60/40 => alice +42, bob +28 (holders pay no gas -> exact deltas)
        assert_eq!(c.env.balance_of(&c.alice), alice_before + U512::from(42_000_000_000u64));
        assert_eq!(c.env.balance_of(&c.bob),   bob_before + U512::from(28_000_000_000u64));
        // contract retains 100 - 70 = 30 CSPR
        assert_eq!(c.env.balance_of(&c.custodian), U512::from(30_000_000_000u64));
        assert!(c.env.emitted_event(&c.custodian, ProceedsDistributed { id, total: U512::from(70_000_000_000u64) }));
    }

    #[test]
    fn cannot_distribute_before_delivery() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        let res = c.custodian.try_distribute(id);
        assert!(res.is_err());
    }

    #[test]
    fn loss_triggers_insurance_prorata() {
        let mut c = setup();
        let id = tokenize(&mut c); // escrow 100, insurance 80, alice 60 / bob 40
        c.custodian.env().set_caller(c.operator);
        c.custodian.report_loss(id);
        let alice_before = c.env.balance_of(&c.alice);
        let bob_before = c.env.balance_of(&c.bob);
        c.custodian.trigger_insurance(id);
        let s = c.custodian.get_shipment(id);
        assert_eq!(s.status, ShipmentStatus::Settled);
        // 80 CSPR split 60/40 => alice +48, bob +32
        assert_eq!(c.env.balance_of(&c.alice), alice_before + U512::from(48_000_000_000u64));
        assert_eq!(c.env.balance_of(&c.bob),   bob_before + U512::from(32_000_000_000u64));
        assert!(c.env.emitted_event(&c.custodian, InsurancePaid { id, total: U512::from(80_000_000_000u64) }));
    }

    #[test]
    fn cannot_insure_without_loss() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        let res = c.custodian.try_trigger_insurance(id);
        assert!(res.is_err());
    }

    #[test]
    fn operator_records_cumulative_data_spend() {
        let mut c = setup();
        let id = tokenize(&mut c);
        c.custodian.env().set_caller(c.operator);
        c.custodian.record_data_spend(id, U512::from(10u64));
        c.custodian.record_data_spend(id, U512::from(15u64));
        assert_eq!(c.custodian.get_data_spend(id), U512::from(25u64));
        assert!(c.env.emitted_event(&c.custodian, DataSpendRecorded { id, amount: U512::from(15u64), cumulative: U512::from(25u64) }));
    }
}

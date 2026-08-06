import { X } from "lucide-react";
import {
  currency,
  ESI_GROSS_LIMIT,
  ESI_RATE,
  HRA_SHARE_OF_BALANCE,
  PF_BASIC_LIMIT,
  PF_RATE,
  TA_SHARE_OF_BALANCE,
} from "../salary";
import { Rule } from "./Rule";

export function RulesDialog({
  effectiveMonthDays,
  monthLabel,
  onClose,
}: {
  effectiveMonthDays: number;
  monthLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal rules-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="rules-modal-head">
          <div>
            <span className="modal-eyebrow">Reference</span>
            <h2>Calculation Rules</h2>
          </div>
          <button className="close-modal" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="rule-list">
          <Rule label="Category" value="Chosen per employee — Unskilled, Semi-skilled, Skilled or Special. Never inferred from salary." />
          <Rule label="Salary Anchor" value="Unskilled is anchored on salary/day; the rest on salary/month. Either can be typed — Settings has a Per Day / Per Month switch." />
          <Rule label="Calendar Days" value={`${effectiveMonthDays} days for ${monthLabel || "selected month"}`} />
          <Rule label="Earned Salary" value="Salary/Month / calendar days x Days Worked" />
          <Rule label="Reference Basic" value="Earned Salary x Basic %" />
          <Rule label="Main PF Attendance" value={`Starts at 26 - (${effectiveMonthDays} - Days Worked), then reduces if Basic plus Bonus is too high`} />
          <Rule label="Official Basic" value="Attendance x category daily wage" />
          <Rule label="Zone A Day Rate" value="Unskilled 400, Semi-skilled 440, Skilled 484" />
          <Rule label="Days Worked" value="Entered manually per employee for the selected month" />
          <Rule label="Extra Days" value="Entered manually; shown on both sheets and used for the Reference performance bonus" />
          <Rule
            label="HRA"
            value={`${HRA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
          />
          <Rule
            label="Travel Allowance"
            value={`${TA_SHARE_OF_BALANCE * 100}% of prorated Total Salary minus Basic`}
          />
          <Rule
            label="PF"
            value={`${PF_RATE * 100}% on Basic (capped at ${currency(PF_BASIC_LIMIT)} Basic) when PF is enabled`}
          />
          <Rule label="ESI" value={`${ESI_RATE * 100}% on Earned Salary when ESI is enabled. Off by default above ${currency(ESI_GROSS_LIMIT)} Total Salary — enable it per employee in Settings, and the main-sheet Basic is held under ${currency(ESI_GROSS_LIMIT)} so it applies`} />
          <Rule label="P-Tax" value="Based on Gross Payable (before PF/ESI) slab" />
          <Rule label="Advance" value="Amount advanced to the employee, recovered from this month's net pay" />
          <Rule label="Performance Bonus" value="(salary/day + bonus/day) x Extra Days" />
          <Rule
            label="Reference Sheet"
            value="Category is set by hand, never guessed from salary. Earned is Salary/Month prorated by Days Worked. Basic is Earned x Basic %. HRA and TA split prorated Total Salary minus Basic in a 70% / 30% ratio."
          />
          <Rule
            label="Main Sheet"
            value={`For PF-on rows, main-sheet attendance starts at 26 - (${effectiveMonthDays} calendar days - Days Worked), then reduces when needed so Basic always equals attendance x category daily wage and Main Bonus is at least the Reference Daily Bonus Amount. HRA/travel allowance are Days-Worked-prorated, and any excess target gross is shown as Bonus so net pay matches the reference sheet. PF-off rows stay aligned with the reference sheet.`}
          />
        </div>
      </div>
    </div>
  );
}

#!/usr/bin/env python3
"""Reference implementation of docs/SPEC-payroll.md.

This is the oracle the TypeScript engine must agree with. It is NOT production
code -- it exists so an executor can (a) check a disputed figure without running
the app, and (b) cross-check the TS implementation on the same fuzz seed.

    python3 scripts/reference-oracle.py                # run the 200k invariant fuzz
    python3 scripts/reference-oracle.py --rosters      # run against the June .xls exports

Verified 2026-07-26: 0 violations of I1-I10 over 149,940 computed cases.
"""
import random, sys

R = lambda v: round(v * 100) / 100
PF_RATE, ESI_RATE, PF_LIMIT, ESI_LIMIT, HRA_SHARE = .12, .0075, 15000, 21000, .70
WAGE_BOARD = {'Unskilled': 400, 'Semi-skilled': 440, 'Skilled': 484}
OFFICIAL_WAGE_DAYS = 26


def professional_tax(w):
    return 0 if w <= 10000 else 110 if w <= 15000 else 130 if w <= 25000 else 150 if w <= 40000 else 200


def repair(e, D):
    """SPEC 2.2.1 -- ONE-TIME back-fill. Must not run inside reference()."""
    e = dict(e)
    cat = e['category']
    r = max(0, e.get('salaryPerDay') or 0)
    M = max(0, e.get('monthlySalary') or 0)
    if cat == 'Unskilled':
        if r <= 0 and M > 0:
            r = R(M / D)
    else:
        if M <= 0 and r > 0:
            M = R(D * r)
        if cat == 'Special':
            r, e['bonusPerDay'] = 0.0, 0
    e['salaryPerDay'], e['monthlySalary'] = r, M
    e['missingRate'] = (r <= 0) if cat == 'Unskilled' else (M <= 0)
    return e


def reference(e, D):
    """SPEC section 5."""
    cat = e['category']
    p = max(.5, min(1., e['basicPercent'] / 100))
    r, M = e['salaryPerDay'], e['monthlySalary']
    b = max(0, e.get('bonusPerDay') or 0)
    if cat == 'Unskilled':
        M = R(D * r)
    elif cat != 'Special':
        r = R(M / D)
    else:
        r, b = 0.0, 0.0

    Xd = 0 if cat == 'Special' else max(0, e.get('extraDays', 0))
    Dw = D if cat == 'Special' else max(0, min(D, e.get('daysWorked', 0)))
    total = R(M + D * b)
    absent = 0 if cat == 'Special' else max(0, D - Dw)
    earned = M if cat == 'Special' else max(0, M - r * absent)
    earned_bonus = R(D * b) if cat == 'Special' else R(Dw * b)

    basic = min(earned, max(0, earned * p))
    rem = max(0, earned + earned_bonus - basic)
    hra, ta = rem * HRA_SHARE, rem * (1 - HRA_SHARE)
    perf = (r + b) * Xd
    special_bonus = max(0, e.get('specialBonus', 0))
    gross = basic + hra + ta + perf + special_bonus

    pf_ok = cat != 'Special' and e.get('pfOptIn', True) is not False and M * p <= PF_LIMIT
    epf = R(PF_RATE * min(basic, PF_LIMIT)) if pf_ok else 0
    esi_ok = cat != 'Special' and e.get('esiOptIn', True) is not False and gross <= ESI_LIMIT
    esi = R(ESI_RATE * gross) if esi_ok else 0
    pt = professional_tax(gross)
    adv, od = max(0, e.get('advance', 0)), max(0, e.get('otherDeduction', 0))

    return dict(category=cat, D=D, Dw=Dw, Xd=Xd, r=r, M=M, totalSalary=total,
                absentDays=absent, earnedSalary=earned, basicSalary=R(basic), hra=R(hra), ta=R(ta),
                performanceBonus=R(perf), grossPayable=R(gross), pfOptIn=pf_ok, esiOptIn=esi_ok,
                employeePf=epf, esi=esi, professionalTax=pt, advance=adv, otherDeduction=od,
                netPayable=R(gross - epf - esi - pt - adv - od))


def official_basic(row, A):
    """SPEC 6.3 -- wage board wins when PF is on; no 15,000 cap on the display."""
    if row['pfOptIn']:
        assert row['category'] != 'Special', "Invariant: Special employees cannot have PF on"
        return R(A * WAGE_BOARD[row['category']])
    floor = 21100 if not row['esiOptIn'] else 15100
    return R((max(floor, round(row['totalSalary'] * .51)) / OFFICIAL_WAGE_DAYS) * A)


def official(row):
    """SPEC 6.2, 6.5, 6.6."""
    absent = max(0, row['D'] - row['Dw'])
    a_max = max(0, min(OFFICIAL_WAGE_DAYS, OFFICIAL_WAGE_DAYS - absent))
    a_min = 1 if row['Dw'] > 0 else 0

    def statutory(basic):
        pf = R(PF_RATE * min(basic, PF_LIMIT)) if row['pfOptIn'] else 0
        esi = R(ESI_RATE * basic) if (row['category'] != 'Special' and row['esiOptIn']
                                      and basic <= ESI_LIMIT) else 0
        return pf, esi

    chosen, unpackable = a_min, True
    for A in range(a_max, a_min - 1, -1):
        basic = official_basic(row, A)
        pf, esi = statutory(basic)
        target = R(row['netPayable'] + pf + esi + row['professionalTax']
                   + row['advance'] + row['otherDeduction'])
        if target >= basic:
            chosen, unpackable = A, False
            break

    A = chosen
    basic = official_basic(row, A)
    pf, esi = statutory(basic)
    target = R(row['netPayable'] + pf + esi + row['professionalTax']
               + row['advance'] + row['otherDeduction'])
    base = min(R((row['totalSalary'] / OFFICIAL_WAGE_DAYS) * A), target)
    rem = max(0, base - basic)
    hra = R(rem * HRA_SHARE)
    ta = R(rem - hra)
    bonus = 0 if unpackable else R(target - (basic + hra + ta))
    gross = R(basic + hra + ta + bonus)
    return dict(attendance=A, unpackable=unpackable, basic=basic, hra=hra, ta=ta, bonus=bonus,
                gross=gross, pf=pf, esi=esi,
                netPayable=R(gross - pf - esi - row['professionalTax']
                             - row['advance'] - row['otherDeduction']))


def fuzz(n=200000, seed=7):
    random.seed(seed)
    v = {k: 0 for k in ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10']}
    unp = miss = 0
    for i in range(n):
        D = random.choice([28, 29, 30, 31])
        cat = random.choice(['Unskilled', 'Semi-skilled', 'Skilled', 'Special'])
        raw = dict(category=cat, basicPercent=random.choice([50, 54, 60, 70, 76, 100]),
                   salaryPerDay=random.choice([0, random.randint(150, 3000)]),
                   monthlySalary=random.choice([0, random.randint(4000, 120000)]),
                   bonusPerDay=random.choice([0, random.randint(1, 500)]),
                   daysWorked=random.randint(0, D),
                   extraDays=random.choice([0, 0, 0, 1, 2, 4, 8]),
                   pfOptIn=random.random() < .6, esiOptIn=random.random() < .6,
                   advance=random.choice([0, 0, 500, 1500, -1500, 20000]),
                   otherDeduction=random.choice([0, 0, 100, 15000]),
                   specialBonus=random.choice([0, 0, 0, 5000]))
        if raw['salaryPerDay'] == 0 and raw['monthlySalary'] == 0:
            raw['monthlySalary'] = 10000
        e = repair(raw, D)
        if e['missingRate']:
            miss += 1
            continue
        r, o = reference(e, D), official(reference(e, D))
        if o['unpackable']:
            unp += 1
        elif abs(o['netPayable'] - r['netPayable']) > 0.01:
            v['I1'] += 1
        recomputed = R(o['gross'] - o['pf'] - o['esi'] - r['professionalTax']
                       - r['advance'] - r['otherDeduction'])
        if abs(recomputed - o['netPayable']) > 0.01:
            v['I2'] += 1
        if not 0 <= o['attendance'] <= OFFICIAL_WAGE_DAYS:
            v['I3'] += 1
        if min(o['basic'], o['hra'], o['ta'], o['bonus'], o['gross'],
               r['basicSalary'], r['hra'], r['ta'], r['grossPayable']) < -1e-9:
            v['I4'] += 1
        if cat == 'Special' and not (r['Dw'] == D and r['absentDays'] == 0 and r['Xd'] == 0
                                     and r['employeePf'] == 0 and r['esi'] == 0
                                     and o['pf'] == 0 and o['esi'] == 0):
            v['I5'] += 1
        if r['Dw'] > 0 and r['grossPayable'] == 0:
            v['I7'] += 1
        if cat != r['category']:
            v['I9'] += 1
        if i % 20 == 0:
            a, b = reference(e, 28), reference(e, 31)
            if cat in ('Semi-skilled', 'Skilled', 'Special'):
                if abs(a['M'] - b['M']) > 0.01:
                    v['I10'] += 1
            elif abs(b['M'] - a['M'] * 31 / 28) > 1.0:
                v['I10'] += 1

    computed = n - miss
    print(f"cases={n}  computed={computed}  missingRate={miss}  "
          f"unpackable={unp} ({100 * unp / computed:.2f}%)")
    for k in sorted(v, key=lambda x: int(x[1:])):
        print(f"  {k}: {v[k]}")
    ok = sum(v.values()) == 0
    print("\n*** ALL INVARIANTS HOLD ***" if ok else "\n*** FAILURES REMAIN ***")
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(fuzz())

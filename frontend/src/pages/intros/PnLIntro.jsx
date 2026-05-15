import IntroPage, { IntroSection, MathSection, TechSection, Callout } from '../../components/IntroPage'

/**
 * P&L Intro — explains what the P&L module does, the math, and where things live.
 *
 * Read order:
 *   1. What this does
 *   2. The two tabs (P&L vs Operating P&L)
 *   3. The math (with worked example)
 *   4. Reconciling with Flipkart's own report
 *   5. Technical details (collapsible)
 */
export default function PnLIntro() {
  return (
    <IntroPage
      emoji="💰"
      title="Profit & Loss"
      tagline="See what you actually earned per SKU vs what you targeted — and whether the business made money."
    >

      <IntroSection title="What this does">
        <p>
          The P&L module compares the <strong>actual settlement</strong> Flipkart paid you
          against the <strong>target prices</strong> you set in the SKUs page — at the per-SKU level
          AND at the business level.
        </p>
        <p>It answers two distinct questions:</p>
        <ul>
          <li><strong>Profit & Loss tab</strong> — "Which SKUs made or lost money this month?"</li>
          <li><strong>Operating P&L tab</strong> — "Did the entire business make money this month, after fixed overhead?"</li>
        </ul>
        <Callout variant="info">
          Upload a Flipkart settlement Excel once per month. The system parses it, matches
          each line to your Casper SKU master, and computes the variance.
        </Callout>
      </IntroSection>

      <IntroSection title="The 4 tabs">
        <p><strong>1. Flipkart Report</strong> — raw data view of the uploaded Excel.</p>
        <p><strong>2. Profit & Loss</strong> — per-SKU spreadsheet. 16 columns grouped into:
          <em> Sold </em>·<em> Target </em>·<em> Actual </em>·<em> Variance / Bottom Line</em>.
          Click 🔗 next to any SKU to jump to its master record.
        </p>
        <p><strong>3. Operating P&L</strong> — executive dashboard with verdict banner,
          KPI strip, and action cards (Kill List, Return Leakage, Data Gap, Volume Absorption).
          NO per-SKU table — that's the P&L tab's job.
        </p>
        <p><strong>4. Insights</strong> — charts: variance waterfall, margin distribution, fee breakdown.</p>
      </IntroSection>

      <MathSection
        title="The math — per SKU"
        formula="Net Profit = Net Payout − Total Cost"
        explanation={
          <>
            For each matched SKU: <strong>Net Payout</strong> is what Flipkart actually wired
            to your bank. <strong>Total Cost</strong> is your full landed cost (price + package +
            inbound logistics + addons + misc + return reserves + damage reserves), multiplied
            by units sold.
          </>
        }
        example={{
          title: 'Example — SHJ-JS-VRI-N65-WHITE',
          inputs: [
            { label: 'Gross units shipped',       value: '30' },
            { label: 'Returns / cancellations',   value: '16' },
            { label: 'Net units sold',            value: '14' },
            { label: 'Net Payout (from FK)',      value: '₹627.49' },
            { label: 'Breakeven (per unit)',      value: '₹129.04' },
            { label: 'Total Cost (14 × ₹129.04)', value: '₹1,806.56' },
          ],
          breakdown: 'Net Profit = 627.49 − 1806.56 = -1,179.07',
          output: { label: 'Net Profit', value: '-₹1,179.07', valueClass: 'red' },
        }}
        variants={[
          {
            title: 'Net Margin (return on cost)',
            formula: 'Net Margin % = Net Profit ÷ Total Cost × 100',
            explanation: (
              <>
                Anchored on cost, not revenue. Tells you "for every ₹100 you spent, you made ₹X."
                A losing SKU shows a negative margin which can exceed -100% when losses outpace cost.
              </>
            ),
            example: {
              title: 'Same SKU',
              inputs: [
                { label: 'Net Profit', value: '-₹1,179.07' },
                { label: 'Total Cost', value: '₹1,806.56' },
              ],
              breakdown: 'Margin = -1179.07 ÷ 1806.56 × 100 = -65.3%',
              output: { label: 'Net Margin', value: '-65.3%', valueClass: 'red' },
            },
          },
        ]}
      />

      <MathSection
        title="The math — business aggregate (Operating P&L)"
        formula="Final Profit = Net Profit − Overhead Drag"
        explanation={
          <>
            Operating P&L adds one more layer on top of per-SKU profit:
            <strong> Overhead Drag</strong>. If you allocated overhead (rent, electricity, manpower)
            into Misc per unit assuming you'd sell <strong>700 units/month</strong>, but only sold 356,
            the 344 missing units didn't recover their share of overhead — that's drag.
          </>
        }
        example={{
          title: 'Example — Mar 2026 month',
          inputs: [
            { label: 'Total Payout (sum of matched SKU settlements)', value: '₹47,690' },
            { label: 'Total Cost (sum of breakeven × units)',         value: '₹48,674' },
            { label: 'Net Profit',                                    value: '-₹984' },
            { label: 'Misc per unit (weighted avg)',                  value: '₹12' },
            { label: 'Target units / Actual units',                   value: '700 / 356' },
            { label: 'Overhead Drag (344 × ₹12)',                     value: '₹4,128' },
          ],
          breakdown: 'Final Profit = -984 − 4128 = -5,112',
          output: { label: 'Final Profit', value: '-₹5,112', valueClass: 'red' },
        }}
      />

      <IntroSection title="Reconciling with Flipkart's own report">
        <p>
          Flipkart's settlement file shows a "<strong>Net Margins %</strong>" column that often
          looks <em>positive</em> even on losing SKUs. That's because FK computes:
        </p>
        <pre className="intro-formula">FK Net Margin %  =  Net Earnings ÷ Accounted Net Sales</pre>
        <p>
          They don't know your cost — they only know <em>their</em> sale and <em>their</em> deductions.
          A SKU can show "+37% margin" in FK's report and still be a real loss for you, because the
          ₹627 they paid is below your ₹1,807 cost.
        </p>
        <Callout variant="warn">
          When you see different margin numbers in Flipkart's report vs Casper, both are correct —
          they answer different questions. Casper anchors on YOUR cost; FK anchors on THEIR revenue.
        </Callout>
      </IntroSection>

      <IntroSection title="Status badges">
        <p>Each P&L row carries a status:</p>
        <ul>
          <li>🟢 <strong>Profit</strong> — Net Payout per unit ≥ Breakeven</li>
          <li>🔴 <strong>Loss</strong> — Net Payout per unit &lt; Breakeven (selling below cost)</li>
        </ul>
        <p>
          Pattern cards in Operating P&L surface SKUs needing attention:
          <em> Kill List</em> (below cost), <em>Return Leakage</em> (return rate &gt; 30%),
          <em>Data Gap</em> (FK SKU not in master).
        </p>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',           value: '/pnl/flipkart/:reportId?view=fk|pnl|ops|insights', code: true },
          { label: 'List page',       value: '/pnl/flipkart',                  code: true },
          { label: 'Frontend entry',  value: 'frontend/src/pages/PnL/FlipkartReport.jsx',     code: true },
          { label: 'P&L view',        value: 'frontend/src/pages/PnL/flipkart/ProfitLossView.jsx',   code: true },
          { label: 'OPL view',        value: 'frontend/src/pages/PnL/flipkart/OperatingPnLView.jsx', code: true },
          { label: 'Compute hook',    value: 'frontend/src/pages/PnL/flipkart/useFlipkartData.js',   code: true },
          { label: 'OPL hook',        value: 'frontend/src/pages/PnL/flipkart/useOperatingPnlData.js', code: true },
          { label: 'API — list',      value: 'GET /api/v1/pnl/reports',          code: true },
          { label: 'API — detail',    value: 'GET /api/v1/pnl/reports/{id}',     code: true },
          { label: 'API — upload',    value: 'POST /api/v1/pnl/upload',          code: true },
          { label: 'Backend schema',  value: 'backend/app/schemas/pnl.py · PnlSkuRowResponse',    code: true },
          { label: 'Backend route',   value: 'backend/app/routes/pnl.py',        code: true },
          { label: 'Parser service',  value: 'backend/app/services/pnl.py',      code: true },
          { label: 'Storage table',   value: 'pnl_reports, pnl_sku_rows',         code: true },
          { label: 'Uploaded files',  value: 'backend/uploads/pnl/{id}.xlsx',     code: true },
          { label: 'Tests',           value: 'frontend/src/tests/pnl.display.test.jsx',    code: true },
          { label: 'Master reference',value: 'memory/logic.md §6',                                code: true },
        ]}
      />

      <IntroSection title="Common edge cases">
        <ul>
          <li><strong>Negative Net Payout</strong> — happens when returns + reverse-ship exceed sales (e.g., SHJ-JS-VRI-N64-BLUE). Math handles this correctly; the SKU lands in the Kill List.</li>
          <li><strong>Unmatched SKUs</strong> — FK SKU names not in your Casper master are excluded from cost/profit calculations (would be misleading to half-compute). Shown in the "Data Gap" pattern card.</li>
          <li><strong>Zero net units</strong> — SKUs where everything was returned/cancelled. Per-unit metrics show "—".</li>
          <li><strong>Stale pricing</strong> — P&L pulls breakeven live from sku_pricing. Edit pricing on SKUs page → refresh report → numbers update.</li>
        </ul>
      </IntroSection>

    </IntroPage>
  )
}

import IntroPage, { IntroSection, MathSection, TechSection, Callout } from '../../components/IntroPage'

/**
 * SKUs Intro — explains the SKU master, the 18-column structure, the bidirectional editors,
 * the breakeven formula, and the per-platform pricing tail.
 */
export default function SKUsIntro() {
  return (
    <IntroPage
      emoji="🧾"
      title="SKUs (Stock Keeping Units)"
      tagline="Your product master. Every cost, every reserve, every target price for every product you sell — all in one row."
    >

      <IntroSection title="What this does">
        <p>
          The SKUs page is your <strong>source of truth</strong> for pricing. Each row is one product.
          You enter your real-world costs (raw price, packaging, logistics, etc.) and the system
          computes everything downstream — breakeven, target price, per-platform listing prices.
        </p>
        <p>
          Edits here flow live into the Pricing page, the P&L module, and the Operating P&L dashboard.
          There is no separate "save and recalculate" step — change a cost, the breakeven updates.
        </p>
        <Callout variant="info">
          Think of it as a spreadsheet with brains. Each row has 18 columns grouped into
          <strong> Unit Economics → Profitability → Bank Settlement → Per-Platform Listing</strong>.
        </Callout>
      </IntroSection>

      <IntroSection title="The 18 columns explained">
        <p><strong>Cost components</strong> (1–5) — your real spend per unit:</p>
        <ul>
          <li><strong>Price</strong> — raw product cost only (vendor invoice)</li>
          <li><strong>Package</strong> — box + label + tape + other packing per unit</li>
          <li><strong>Inbound Logistics</strong> — vendor/factory → warehouse (outbound is platform's job)</li>
          <li><strong>Addons</strong> — free gifts, extras bundled with each unit</li>
          <li><strong>Misc</strong> — overhead per unit (rent ÷ target units, etc.)</li>
        </ul>
        <p><strong>Reserves</strong> (6–9) — money you set aside per unit for returns and damage:</p>
        <ul>
          <li><strong>CR % / CR ₹</strong> — bidirectional. Customer Return target ceiling. ₹ = % × platform reverse-shipping cost.</li>
          <li><strong>Damage % / Damage ₹</strong> — bidirectional. Anchored on Price. Damaged unit = full write-off.</li>
        </ul>
        <p><strong>Profitability</strong> (10–13) — the floor and the goal:</p>
        <ul>
          <li><strong>Breakeven</strong> — cost recovery floor (cost + reserves)</li>
          <li><strong>Breakeven (GST)</strong> — breakeven × (1 + GST%)</li>
          <li><strong>Profit % / Profit ₹</strong> — bidirectional. Target margin on top of breakeven.</li>
        </ul>
        <p><strong>Bank Settlement</strong> (14–15) — what you want to receive:</p>
        <ul>
          <li><strong>Target Pre-GST</strong> — breakeven + profit</li>
          <li><strong>Target Post-GST</strong> — Target Pre-GST + GST</li>
        </ul>
        <p><strong>Per-platform tail</strong> (16–18) — varies by platform:</p>
        <ul>
          <li><strong>AD %/₹</strong> — advertising/acquisition cost per unit (varies by platform)</li>
          <li><strong>Tier</strong> — platform commission. Dual-mode: % or ₹.</li>
          <li><strong>BS per Platform</strong> — listing price (MRP) calculated for that platform</li>
        </ul>
      </IntroSection>

      <MathSection
        title="The math — how breakeven is built"
        formula={`Landed Cost   =  Price + Package + Inbound Log + Addons + Misc
CR Reserve    =  CR %    × Platform.reverse_ship_cost
Damage Reserve = Damage % × Price
Breakeven     =  Landed Cost + CR Reserve + Damage Reserve`}
        explanation={
          <>
            Breakeven is the <strong>floor</strong> — the price below which you lose money
            on this SKU. It bakes in your costs PLUS the reserves you keep for returns and damage.
            Above this number = profit. Below = loss.
          </>
        }
        example={{
          title: 'Worked example — jewellery SKU',
          inputs: [
            { label: 'Price',                                value: '₹63' },
            { label: 'Package',                              value: '₹7' },
            { label: 'Inbound Logistics',                    value: '₹10' },
            { label: 'Addons',                               value: '₹6' },
            { label: 'Misc (overhead/unit)',                 value: '₹12' },
            { label: 'CR Reserve (20% × ₹168)',              value: '₹33.60' },
            { label: 'Damage Reserve (8% × ₹63)',            value: '₹5.04' },
          ],
          breakdown: 'Breakeven = 63 + 7 + 10 + 6 + 12 + 33.60 + 5.04 = ₹136.64',
          output: { label: 'Breakeven', value: '₹136.64', valueClass: '' },
        }}
        variants={[
          {
            title: 'Adding profit + GST → Target Post-GST (final listing target)',
            formula: `Target Pre-GST  = Breakeven + (Breakeven × Profit %)
Target Post-GST = Target Pre-GST × (1 + GST %)`,
            explanation: 'Profit is markup on top of breakeven. GST is added last.',
            example: {
              title: 'Continuing from above',
              inputs: [
                { label: 'Breakeven',                            value: '₹136.64' },
                { label: 'Profit % (target margin)',             value: '20%' },
                { label: 'Profit ₹ (136.64 × 20%)',              value: '₹27.33' },
                { label: 'Target Pre-GST (136.64 + 27.33)',      value: '₹164' },
                { label: 'GST % (slab from category/HSN)',       value: '5%' },
              ],
              breakdown: 'Target Post-GST = 164 × 1.05 = ₹172',
              output: { label: 'Target Post-GST (what you want from FK)', value: '₹172', valueClass: 'green' },
            },
          },
        ]}
      />

      <IntroSection title="Bidirectional editing — type either % or ₹">
        <p>
          CR, Damage, and Profit each have a <strong>%</strong> and a <strong>₹</strong> field that
          stay in sync. Type 20 in the % field — the ₹ field auto-fills. Type ₹34 in the ₹ field —
          the % back-computes. The math is the same; only the unit you enter changes.
        </p>
        <p>
          Anchors (the "what is this a percentage OF?"):
        </p>
        <ul>
          <li><strong>CR ₹</strong> = CR % × <em>Platform's reverse-shipping cost</em> (e.g., Flipkart = ₹168)</li>
          <li><strong>Damage ₹</strong> = Damage % × <em>Price</em></li>
          <li><strong>Profit ₹</strong> = Profit % × <em>Breakeven (no GST)</em></li>
        </ul>
      </IntroSection>

      <IntroSection title="Category defaults cascade">
        <p>
          New SKUs auto-fill CR %, Damage %, and Profit % from their <strong>category's defaults</strong>.
          For example, if "Jewellery Set" is set to CR=20% / Dmg=15% / Profit=20%, creating a new SKU
          in that category gets those values pre-filled.
        </p>
        <p>You can still override any field per SKU. The cascade only fills <em>empty</em> fields — never overrides what you typed.</p>
        <Callout variant="success">
          Manage category defaults: SKUs page → category dropdown → <em>Manage Categories →</em>.
        </Callout>
      </IntroSection>

      <IntroSection title="Per-platform pricing tail (AD / Tier / Listing)">
        <p>Each row has a section per active platform showing:</p>
        <ul>
          <li><strong>AD %/₹</strong> — your advertising cost per unit on that platform. Use the <strong>↑ Upload Ad</strong>
            button in the platform header to import a CSV/XLSX of campaign spend and auto-compute per-SKU AD/unit.</li>
          <li><strong>Tier</strong> — dropdown of named commission tiers for that platform (e.g., Standard / Premium). Each tier carries
            either a fixed ₹ fee or a % of base BS. Click "<strong>+ Add tier…</strong>" in the dropdown to create
            a new tier without leaving this page.</li>
          <li><strong>BS per Platform</strong> — the listing price (MRP) Casper recommends so that, after the platform's
            deductions, you still hit your Target Pre-GST.</li>
        </ul>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',           value: '/skus',                                       code: true },
          { label: 'Frontend entry',  value: 'frontend/src/pages/SKUs.jsx',                 code: true },
          { label: 'Compute function',value: 'SKUs.jsx · compute()',                         code: true },
          { label: 'Per-platform calc',value: 'SKUs.jsx · computePlatform()',                code: true },
          { label: 'Bidirectional editor', value: 'frontend/src/components/BidirectionalPctAmount.jsx', code: true },
          { label: 'Category mgmt modal',  value: 'frontend/src/components/ManageCategoriesModal.jsx', code: true },
          { label: 'Quick-add tier modal', value: 'frontend/src/components/AddTierQuickModal.jsx',     code: true },
          { label: 'Ad-report upload',     value: 'frontend/src/components/UploadAdReportModal.jsx',  code: true },
          { label: 'API — list',      value: 'GET /api/v1/skus',                            code: true },
          { label: 'API — create/update', value: 'POST /api/v1/skus, PATCH /api/v1/skus/:id', code: true },
          { label: 'Backend model',   value: 'backend/app/models/sku.py · Sku, SkuPricing', code: true },
          { label: 'Backend schema',  value: 'backend/app/schemas/sku.py',                  code: true },
          { label: 'Pricing service', value: 'backend/app/services/pricing.py',             code: true },
          { label: 'Storage tables',  value: 'skus, sku_pricing, sku_platform_config',       code: true },
          { label: 'Tests',           value: 'backend/tests/test_pricing.py',               code: true },
          { label: 'Master reference',value: 'memory/logic.md §2 (18-column reference)',     code: true },
        ]}
      />

      <IntroSection title="Common gotchas">
        <ul>
          <li><strong>Misc is a per-unit average</strong> — based on overhead ÷ target net delivered units/month. Reviewed quarterly.</li>
          <li><strong>CR reserve under-funds reality</strong> when actual CR % exceeds your target. The "Return Leakage" pattern card in Operating P&L flags SKUs where actual &gt; 30%.</li>
          <li><strong>Damage anchors on Price only</strong> (not full landed cost). Slightly under-reserves the true write-off cost; parked for revisit in <code>ideas_parking.md</code>.</li>
          <li><strong>GST is platform-pass-through</strong> — collected on sale, remitted to government. Doesn't reduce your bank settlement but is accounted in Target Post-GST.</li>
        </ul>
      </IntroSection>

    </IntroPage>
  )
}

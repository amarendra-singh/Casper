import IntroPage, { IntroSection, MathSection, TechSection, Callout } from '../../components/IntroPage'

export default function PricingIntro() {
  return (
    <IntroPage
      emoji="🏷️"
      title="Pricing"
      tagline="Enter or edit the full cost breakdown for one SKU across all platforms — focused form view."
    >

      <IntroSection title="What this does">
        <p>
          The Pricing page is a <strong>focused form</strong> for entering or editing one SKU's
          cost inputs per platform. It shows every field — Price, Package, Inbound Logistics,
          Addons, Misc, CR, Damage, GST — in a clean card layout instead of the wide table
          on the SKUs page.
        </p>
        <p>
          Use it when you want to set up a new SKU's pricing from scratch, or when you need
          to review all cost fields for one product without scrolling horizontally.
        </p>
        <Callout variant="info">
          The SKUs page and Pricing page share the same data. Editing in one is reflected
          immediately in the other — they are two views of the same record.
        </Callout>
      </IntroSection>

      <IntroSection title="The cost fields">
        <ul>
          <li><strong>Price</strong> — raw product cost (vendor invoice, no overhead)</li>
          <li><strong>Package</strong> — box + label + tape per unit</li>
          <li><strong>Inbound Logistics</strong> — vendor → warehouse cost (outbound is platform's job)</li>
          <li><strong>Addons</strong> — free gifts or extras bundled with each unit</li>
          <li><strong>Misc</strong> — overhead per unit (rent ÷ target units, electricity, manpower, etc.)</li>
          <li><strong>CR %</strong> — customer return target ceiling; CR ₹ = CR % × platform reverse-ship cost</li>
          <li><strong>Damage %</strong> — damage write-off ceiling; Damage ₹ = Damage % × Price</li>
          <li><strong>GST %</strong> — tax slab for this product (0 / 3 / 5 / 12 / 18 / 28)</li>
        </ul>
      </IntroSection>

      <MathSection
        title="How the form computes your target price"
        formula={`Landed Cost     = Price + Package + Inbound Log + Addons + Misc
Breakeven       = Landed Cost + CR Reserve + Damage Reserve
Target Pre-GST  = Breakeven + (Breakeven × Profit %)
Target Post-GST = Target Pre-GST × (1 + GST %)`}
        explanation="Fill in the cost fields and the system instantly shows your breakeven and target bank settlement. This is the number you want Flipkart / Meesho / Snapdeal to pay you per unit."
        example={{
          title: 'Example — jewellery SKU',
          inputs: [
            { label: 'Price + Package + Logistics + Addons + Misc', value: '₹98' },
            { label: 'CR Reserve (20% × ₹168)',                     value: '₹33.60' },
            { label: 'Damage Reserve (8% × ₹63)',                   value: '₹5.04' },
            { label: 'Breakeven',                                    value: '₹136.64' },
            { label: 'Profit % target',                              value: '20%' },
            { label: 'GST slab',                                     value: '5%' },
          ],
          breakdown: 'Target Pre-GST = 136.64 × 1.20 = ₹164  →  Target Post-GST = 164 × 1.05 = ₹172',
          output: { label: 'Target Post-GST (what to aim for from platform)', value: '₹172', valueClass: 'green' },
        }}
      />

      <IntroSection title="Per-platform cards">
        <p>
          Each active platform gets its own card. Within each card you can also set:
        </p>
        <ul>
          <li><strong>Tier</strong> — the platform commission tier (e.g., Standard ₹71.5 or Premium 5%)</li>
          <li><strong>AD ₹/unit</strong> — advertising cost per unit on that platform</li>
          <li><strong>Listing Price</strong> — back-calculated MRP so you still hit Target Post-GST after deductions</li>
        </ul>
        <Callout variant="warn">
          If a platform's reverse-shipping cost changes, update it in <strong>Settings → Platforms</strong>.
          The CR Reserve in every SKU auto-recomputes on next load.
        </Callout>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',             value: '/pricing/:skuId?',                          code: true },
          { label: 'Frontend entry',    value: 'frontend/src/pages/Pricing.jsx',            code: true },
          { label: 'API — list SKUs',   value: 'GET /api/v1/skus',                          code: true },
          { label: 'API — get pricing', value: 'GET /api/v1/pricing/:skuId',                code: true },
          { label: 'API — create',      value: 'POST /api/v1/pricing',                      code: true },
          { label: 'API — update',      value: 'PATCH /api/v1/pricing/:id',                 code: true },
          { label: 'API — delete',      value: 'DELETE /api/v1/pricing/:id',                code: true },
          { label: 'Backend model',     value: 'backend/app/models/sku.py · SkuPricing',    code: true },
          { label: 'Pricing service',   value: 'backend/app/services/pricing.py',           code: true },
          { label: 'Storage tables',    value: 'sku_pricing, sku_platform_config',           code: true },
          { label: 'Master reference',  value: 'memory/logic.md §2–§3',                     code: true },
        ]}
      />

    </IntroPage>
  )
}

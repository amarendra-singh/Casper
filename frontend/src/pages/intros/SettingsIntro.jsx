import IntroPage, { IntroSection, TechSection, Callout } from '../../components/IntroPage'

export default function SettingsIntro() {
  return (
    <IntroPage
      emoji="⚙️"
      title="Settings"
      tagline="Configure platforms, commission tiers, and reverse-shipping rates — the foundation every SKU price builds on."
    >

      <IntroSection title="What this does">
        <p>
          Settings is where you manage the <strong>platform configuration</strong> that drives
          all pricing calculations across the app. Every number you enter here flows into
          the SKUs page breakeven formula and the P&L computations.
        </p>
        <p>Key things you configure here:</p>
        <ul>
          <li><strong>Platforms</strong> — Flipkart, Meesho, Snapdeal, Amazon, etc.</li>
          <li><strong>Reverse-shipping cost</strong> per platform — the fee charged per return</li>
          <li><strong>Commission tiers</strong> per platform — named tiers with a fixed ₹ or % fee</li>
          <li><strong>Default AD %</strong> per platform — advertising cost assumption</li>
        </ul>
        <Callout variant="warn">
          Changing a platform's reverse-shipping cost affects the CR Reserve on <em>every SKU</em>
          linked to that platform. Review affected SKUs after any change.
        </Callout>
      </IntroSection>

      <IntroSection title="Platforms">
        <p>
          Each platform record stores:
        </p>
        <ul>
          <li><strong>Name</strong> — Flipkart, Meesho, Snapdeal, Amazon, etc.</li>
          <li><strong>Reverse-ship cost (CR Charge)</strong> — what the platform charges you when a
            customer returns an item. Currently: Flipkart = ₹168. Used as the anchor for CR Reserve
            in every SKU: <code>CR ₹ = CR % × reverse_ship_cost</code>.</li>
          <li><strong>Default AD %</strong> — platform-wide advertising default. Snapdeal = 10%.
            Can be overridden per SKU via ad-report upload on the SKUs page.</li>
        </ul>
      </IntroSection>

      <IntroSection title="Commission tiers">
        <p>
          Each platform has one or more named commission tiers — for example:
        </p>
        <ul>
          <li><strong>Standard</strong> — ₹71.5 flat fee per order (Flipkart example)</li>
          <li><strong>Premium</strong> — 5% of base bank settlement</li>
        </ul>
        <p>
          Each tier can be set as a <strong>fixed ₹ amount</strong> OR a <strong>% of MRP</strong>.
          When editing, switch the mode dropdown between <code>₹</code> and <code>%</code>.
        </p>
        <p>
          On the SKUs page, each (SKU, platform) pair picks one of these tiers.
          The listing price is back-calculated so that after the tier deduction you still hit your
          Target Post-GST.
        </p>
        <Callout variant="info">
          You can also add a tier directly from the SKUs page tier dropdown — click "+ Add tier…"
          without navigating here.
        </Callout>
      </IntroSection>

      <IntroSection title="How settings flow into pricing">
        <p>The chain from Settings → SKU price:</p>
        <ol>
          <li>Settings: <strong>reverse_ship_cost = ₹168</strong> for Flipkart</li>
          <li>SKUs page: CR % = 20% → <strong>CR Reserve = 20% × 168 = ₹33.60/unit</strong></li>
          <li>Breakeven includes CR Reserve → rises by ₹33.60</li>
          <li>Target Post-GST rises accordingly → Listing Price rises</li>
        </ol>
        <p>
          If Flipkart raises their reverse-ship fee from ₹168 → ₹185, update it here once —
          all 50 SKUs recalculate automatically.
        </p>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',                value: '/settings',                                     code: true },
          { label: 'Frontend entry',       value: 'frontend/src/pages/Settings.jsx',               code: true },
          { label: 'API — list platforms', value: 'GET /api/v1/platforms',                         code: true },
          { label: 'API — update platform',value: 'PATCH /api/v1/platforms/:id',                   code: true },
          { label: 'API — list tiers',     value: 'GET /api/v1/platforms/:id/tiers',               code: true },
          { label: 'API — create tier',    value: 'POST /api/v1/platforms/:id/tiers',              code: true },
          { label: 'API — update tier',    value: 'PATCH /api/v1/platforms/:id/tiers/:tierId',     code: true },
          { label: 'API — delete tier',    value: 'DELETE /api/v1/platforms/:id/tiers/:tierId',    code: true },
          { label: 'Backend model',        value: 'backend/app/models/platform.py',                code: true },
          { label: 'Storage tables',       value: 'platforms, platform_tiers',                     code: true },
          { label: 'CR charge field',      value: 'platforms.cr_charge (maps to reverse_ship_cost)', code: true },
          { label: 'Tier fee fields',      value: 'platform_tiers.fee (₹), platform_tiers.fee_pct (%)', code: true },
        ]}
      />

    </IntroPage>
  )
}

import IntroPage, { IntroSection, TechSection, Callout } from '../../components/IntroPage'

/**
 * Dashboard Intro — what the home page shows and where its data comes from.
 */
export default function DashboardIntro() {
  return (
    <IntroPage
      emoji="🏠"
      title="Dashboard"
      tagline="Your business at a glance — revenue, units, platforms, and key trends in one place."
    >

      <IntroSection title="What this does">
        <p>
          The Dashboard is your <strong>starting view</strong> after login. It rolls up the data from
          SKUs, Pricing, and uploaded P&L reports into a single summary so you can answer in 5 seconds:
          <em> "How is the business doing this month?"</em>
        </p>
        <Callout variant="info">
          Every section is driven by <strong>your own live data</strong>, scoped to the active company.
          A brand-new company starts empty and fills in as you add SKUs, pricing, and upload P&L reports.
        </Callout>
      </IntroSection>

      <IntroSection title="Sections on the page">
        <ul>
          <li><strong>Metrics ribbon</strong> — sell-through, customer-return, RTO, fraud-signal rate, settlement rate, avg net margin, and top fraud signals.</li>
          <li><strong>Insight cards</strong> — the few things that need attention right now, auto-surfaced from your data.</li>
          <li><strong>Channel performance</strong> — margin and volume per platform over recent weeks.</li>
          <li><strong>SKU intelligence</strong> — per-SKU profitability, return/RTO rates, and status vs. break-even.</li>
          <li><strong>Settlement reconciliation</strong> — settled vs. expected payout and where cash is leaking.</li>
          <li><strong>Fraud action pipeline</strong> — flagged actors and recommended actions.</li>
          <li><strong>Reports</strong> — order funnel, fee waterfall, and return-reason drill-down.</li>
        </ul>
      </IntroSection>

      <IntroSection title="What to do from here">
        <p>The Dashboard is a launchpad. Common next steps:</p>
        <ul>
          <li>Spotting a dip in margin? → Open <strong>P&L → Operating P&L</strong> to find the cause.</li>
          <li>Adding a new product? → <strong>SKUs → Manage SKUs</strong>.</li>
          <li>Uploading this month's settlement? → <strong>P&L → Flipkart</strong> (or other platform).</li>
          <li>Want to understand a number? → Every menu has its own <strong>📖 Intro</strong> sub-page.</li>
        </ul>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',          value: '/',                                       code: true },
          { label: 'Frontend entry', value: 'frontend/src/pages/Dashboard.jsx',        code: true },
          { label: 'Report header',  value: 'frontend/src/components/dashboard/ReportHeader.jsx', code: true },
          { label: 'Chart library',  value: 'recharts',                                code: true },
          { label: 'Styling base',   value: 'TailwindCSS v4 + custom CSS variables',   code: true },
          { label: 'Data sources',   value: '/api/v1/dashboard/{metrics,insights,sku-intelligence,reconciliation,action-pipeline,operations}', code: true },
          { label: 'Status',         value: 'All sections live — company-scoped, no placeholder data', code: false },
        ]}
      />

    </IntroPage>
  )
}

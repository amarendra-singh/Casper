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
        <Callout variant="warn">
          Several sections currently render <strong>dummy / placeholder data</strong> while we wire
          them to live APIs. The header KPIs and platform donut will be the first to go live;
          the bar chart and team panel are scheduled later.
        </Callout>
      </IntroSection>

      <IntroSection title="Sections on the page">
        <ul>
          <li><strong>Header KPIs</strong> — Gross Sales, Net Sales, Units Sold, Net Margin %. Pulled from the latest P&L report.</li>
          <li><strong>Platform donut</strong> — revenue split across active platforms (Flipkart / Meesho / etc.).</li>
          <li><strong>Sales-over-time bar chart</strong> — month-by-month revenue trend.</li>
          <li><strong>Recent activity / team panel</strong> — who edited what, latest uploads.</li>
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
          { label: 'Data sources',   value: '/api/v1/pnl/reports, /api/v1/platforms, /api/v1/skus', code: true },
          { label: 'Status',         value: 'Some sections use dummy data — being migrated to live APIs', code: false },
        ]}
      />

    </IntroPage>
  )
}

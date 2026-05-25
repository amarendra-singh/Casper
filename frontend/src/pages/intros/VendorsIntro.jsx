import IntroPage, { IntroSection, TechSection, Callout } from '../../components/IntroPage'

export default function VendorsIntro() {
  return (
    <IntroPage
      emoji="🏭"
      title="Vendors"
      tagline="Your supplier master. Track who supplies what, link SKUs to their source, and keep short codes consistent."
    >

      <IntroSection title="What this does">
        <p>
          The Vendors page manages your <strong>supplier list</strong> — the businesses or individuals
          you buy products from. Each vendor has a name and a short code (e.g., <code>SHJ</code>)
          that prefixes your SKU IDs so you always know the source at a glance.
        </p>
        <p>
          A vendor is linked to SKUs — each SKU belongs to one vendor. The count on each vendor
          card shows how many SKUs are sourced from that supplier.
        </p>
        <Callout variant="info">
          Short codes are auto-uppercased and should be 2–5 characters. Once used in SKU names,
          changing a short code does not rename existing SKUs — only new ones use the updated code.
        </Callout>
      </IntroSection>

      <IntroSection title="How vendors connect to SKUs">
        <p>
          When you create a SKU, you pick a vendor from a dropdown. That vendor's short code
          namespaces the SKU ID — for example:
        </p>
        <ul>
          <li>Vendor: <strong>Shringar House</strong>, code: <code>SHJ</code></li>
          <li>SKU: <code>SHJ-JS-VRI-N65-WHITE</code> — prefix tells you it came from Shringar House</li>
        </ul>
        <p>
          This makes it easy to sort, filter, and group SKUs by supplier in bulk exports and reports.
        </p>
      </IntroSection>

      <IntroSection title="Categories">
        <p>
          Each SKU also belongs to a <strong>category</strong> (e.g., Jewellery Set, Saree Petticoat).
          Categories carry <strong>default values</strong> for CR %, Damage %, and Profit % — so new
          SKUs in that category get sensible defaults without manual entry every time.
        </p>
        <p>Manage categories from: SKUs page → category dropdown → <em>Manage Categories →</em></p>
        <Callout variant="success">
          Category defaults only fill <em>empty</em> fields. They never override values you've
          already typed for a SKU.
        </Callout>
      </IntroSection>

      <IntroSection title="Common operations">
        <ul>
          <li><strong>Add vendor</strong> — click "+ Add Vendor", enter name + short code.</li>
          <li><strong>Edit</strong> — click the edit icon on any row, change name or code, save.</li>
          <li><strong>Delete</strong> — only available if the vendor has 0 linked SKUs. Re-assign
            or delete linked SKUs first.</li>
        </ul>
      </IntroSection>

      <TechSection
        items={[
          { label: 'Route',          value: '/vendors',                           code: true },
          { label: 'Frontend entry', value: 'frontend/src/pages/Vendors.jsx',     code: true },
          { label: 'API — list',     value: 'GET /api/v1/vendors',                code: true },
          { label: 'API — create',   value: 'POST /api/v1/vendors',               code: true },
          { label: 'API — update',   value: 'PATCH /api/v1/vendors/:id',          code: true },
          { label: 'API — delete',   value: 'DELETE /api/v1/vendors/:id',         code: true },
          { label: 'Backend model',  value: 'backend/app/models/vendor.py',       code: true },
          { label: 'Storage table',  value: 'vendors',                            code: true },
          { label: 'SKU count src',  value: 'entries table (vendor_id FK)',        code: true },
        ]}
      />

    </IntroPage>
  )
}

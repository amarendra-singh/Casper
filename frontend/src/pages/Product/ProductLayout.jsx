import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import './Product.css'

const TABS = [
  { key: 'catalogue', label: 'Catalogue', path: '/product/catalogue' },
  { key: 'unit-economics', label: 'Unit Economics', path: '/product/unit-economics' },
  { key: 'categories',     label: 'Categories',     path: '/product/categories' },
]

export default function ProductLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const activeTab = TABS.find(t => location.pathname.startsWith(t.path))?.key || 'catalogue'

  return (
    <div className="product-layout">
      <nav className="product-tabs">
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`product-tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="product-body">
        <Outlet />
      </div>
    </div>
  )
}

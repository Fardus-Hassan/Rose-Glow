import { useEffect, useState } from "react"
import Notifications from "./notifications.jsx"
import Courier from "./pages/Courier.jsx"
import Dashboard from "./pages/Dashboard.jsx"
import Inventory from "./pages/Inventory.jsx"
import OrderCreate from "./pages/OrderCreate.jsx"
import OrderDetail from "./pages/OrderDetail.jsx"
import Orders from "./pages/Orders.jsx"
import { RouteContext } from "./route.jsx"

const NAV = [
  { href: "/", label: "Dashboard", short: "Home", icon: "board" },
  { href: "/orders/new", label: "New order", short: "New", icon: "plus" },
  { href: "/orders", label: "All orders", short: "Orders", icon: "list" },
  { href: "/inventory", label: "Inventory", short: "Stock", icon: "box" },
  { href: "/courier", label: "Courier", short: "Parcels", icon: "truck" },
]

function locationKey() {
  return `${window.location.pathname}${window.location.search}`
}

export default function App() {
  const [key, setKey] = useState(locationKey)

  useEffect(() => {
    const onPop = () => setKey(locationKey())
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  function go(href) {
    window.history.pushState({}, "", href)
    setKey(href.split("?")[0])
  }

  const path = key.split("?")[0]

  const orderMatch = path.match(/^\/orders\/(\d+)$/)
  let page = <Dashboard />
  if (path === "/orders/new") page = <OrderCreate />
  else if (orderMatch) page = <OrderDetail id={Number(orderMatch[1])} />
  else if (path === "/orders") page = <Orders />
  else if (path === "/inventory") page = <Inventory />
  else if (path === "/courier") page = <Courier />
  else if (path !== "/") page = <Missing go={go} />

  return (
    <RouteContext.Provider value={{ go, path }}>
      <div className="app">
        <aside className="side">
          <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go("/") }}>
            <RoseMark />
            <span>
              <strong>Rose Glow</strong>
              <small>Jewelry ledger</small>
            </span>
          </a>
          <nav className="side-nav" aria-label="Main menu">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={isCurrent(item.href, path) ? "active" : ""}
                aria-current={isCurrent(item.href, path) ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); go(item.href) }}
              >
                <Icon name={item.icon} />
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="workspace">
          <header className="topbar">
            <a className="brand" href="/" onClick={(event) => { event.preventDefault(); go("/") }}>
              <RoseMark />
              <span>
                <strong>Rose Glow</strong>
                <small>Jewelry ledger</small>
              </span>
            </a>
            <Notifications />
          </header>
          <main>{page}</main>
          <nav className="tabbar" aria-label="Main menu">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={isCurrent(item.href, path) ? "active" : ""}
                aria-current={isCurrent(item.href, path) ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); go(item.href) }}
              >
                <Icon name={item.icon} />
                {item.short}
              </a>
            ))}
          </nav>
        </div>
      </div>
    </RouteContext.Provider>
  )
}

function isCurrent(href, path) {
  if (href === "/orders") return path === "/orders" || /^\/orders\/\d+$/.test(path)
  return path === href
}

function Missing({ go }) {
  return (
    <section className="page">
      <div className="card missing">
        <h1>This page does not exist</h1>
        <button type="button" className="btn" onClick={() => go("/")}>Go to dashboard</button>
      </div>
    </section>
  )
}

function RoseMark() {
  return <img className="mark" src="/mark.png" alt="" />
}

function Icon({ name }) {
  const pen = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  }
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "board" ? (
        <>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" {...pen} />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" {...pen} />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" {...pen} />
          <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" {...pen} />
        </>
      ) : null}
      {name === "plus" ? (
        <>
          <circle cx="12" cy="12" r="8" {...pen} />
          <path d="M12 8.5v7M8.5 12h7" {...pen} />
        </>
      ) : null}
      {name === "list" ? (
        <>
          <path d="M8 7h11M8 12h11M8 17h11" {...pen} />
          <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" {...pen} />
        </>
      ) : null}
      {name === "box" ? (
        <>
          <path d="M3.8 8.2 12 4.5l8.2 3.7L12 11.8 3.8 8.2z" {...pen} />
          <path d="M3.8 8.2V16L12 19.6 20.2 16V8.2" {...pen} />
          <path d="M12 11.8v7.8" {...pen} />
        </>
      ) : null}
      {name === "truck" ? (
        <>
          <path d="M3.5 7.5h10v8h-10z" {...pen} />
          <path d="M13.5 10.5h4.2L20.5 13v2.5h-7" {...pen} />
          <circle cx="7.2" cy="17.2" r="1.5" {...pen} />
          <circle cx="16.8" cy="17.2" r="1.5" {...pen} />
        </>
      ) : null}
    </svg>
  )
}

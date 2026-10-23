import { createContext, useContext } from "react"

export const RouteContext = createContext(null)

export function useRoute() {
  return useContext(RouteContext)
}

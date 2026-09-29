import { createHarborTheme } from './harbor.js'

// 主题注册表：名字 → 工厂函数。顺序就是预览页按钮的顺序。
export const THEME_FACTORIES = {
  harbor: createHarborTheme,
}

export const THEME_ORDER = Object.keys(THEME_FACTORIES)

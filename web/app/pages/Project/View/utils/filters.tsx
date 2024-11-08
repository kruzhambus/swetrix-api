import React from 'react'
import { IFilter } from '../interfaces/traffic'
import _includes from 'lodash/includes'
import _replace from 'lodash/replace'
import _startsWith from 'lodash/startsWith'
import _some from 'lodash/some'
import _keys from 'lodash/keys'
import _reduce from 'lodash/reduce'

export const ERROR_FILTERS_MAPPING = {
  showResolved: 'showResolved',
}

export const FILTER_CHART_METRICS_MAPPING_FOR_COMPARE = ['bounce', 'viewsPerUnique', 'trendlines', 'customEvents']

export const validTimeBacket = ['hour', 'day', 'week', 'month']
export const validPeriods = ['custom', 'today', 'yesterday', '1d', '7d', '4w', '3M', '12M', '24M']
export const validFilters = [
  'cc',
  'rg',
  'ct',
  'pg',
  'lc',
  'ref',
  'dv',
  'br',
  'os',
  'so',
  'me',
  'ca',
  'ev',
  'tag:key',
  'tag:value',
  'ev:key',
  'ev:value',
]
// dynamic filters is when a filter column starts with a specific value and is followed by some arbitrary string
// this is done to build a connnection between dynamic column and value (e.g. for custom event metadata or page properties)
const validDynamicFilters = ['ev:key:', 'tag:key:']

export const filterInvalidViewPrefs = (prefs: any): any => {
  const pids = _keys(prefs)
  const filtered = _reduce(
    pids,
    (prev: string[], curr: string) => {
      const { period, timeBucket } = prefs[curr]

      if (!_includes(validPeriods, period) || !_includes(validTimeBacket, timeBucket)) {
        return prev
      }

      return [...prev, curr]
    },
    [],
  )

  return _reduce(
    filtered,
    (prev: any, curr: string) => {
      return {
        ...prev,
        [curr]: prefs[curr],
      }
    },
    {},
  )
}

export const isFilterValid = (filter: string, checkDynamicFilters = false) => {
  if (_includes(validFilters, filter)) {
    return true
  }

  if (checkDynamicFilters && _some(validDynamicFilters, (prefix) => _startsWith(filter, prefix))) {
    return true
  }

  return false
}
export const applyFilters = (items: IFilter[], suffix: string, url: URL, override: boolean): IFilter[] => {
  const filtersToLoad: IFilter[] = []
  items.forEach((item) => {
    if (!item.filter) return

    const filters = Array.isArray(item.filter) ? item.filter : [item.filter]
    if (filters.length === 0) return

    const columnSuffix = `${item.column}${suffix}`

    if (override || !url.searchParams.has(columnSuffix)) {
      url.searchParams.delete(columnSuffix)
      filters.forEach((filter) => url.searchParams.append(columnSuffix, filter))
    }

    filtersToLoad.push(item)
  })
  return filtersToLoad
}

export const handleNavigationParams = (
  items: IFilter[],
  suffix: string,
  url: URL,
  navigate: (url: string) => void,
  override: boolean,
  stateSetter: React.Dispatch<React.SetStateAction<IFilter[]>>,
  loader: (forceReload: boolean, filters: IFilter[]) => void,
): void => {
  const filters = applyFilters(items, suffix, url, override)
  const { pathname, search } = url
  navigate(`${pathname}${search}`)
  stateSetter(override ? filters : (prev) => [...prev, ...filters])
  loader(true, filters)
}

export const updateFilterState = (
  navigate: (str: string) => void,
  filters: IFilter[],
  newFiltersStateSetter: React.Dispatch<React.SetStateAction<IFilter[]>>,
  column: string,
  columnSuffix: string,
  filter: any,
  isExclusive: boolean,
) => {
  const existingFilterIndex = filters.findIndex((f) => f.filter === filter)
  const url = new URL(window.location.href)
  const { pathname, search } = url

  let updatedFilters: IFilter[]

  if (existingFilterIndex > -1) {
    updatedFilters = filters.filter((_, index) => index !== existingFilterIndex)
    url.searchParams.delete(column)
  } else {
    updatedFilters = [...filters, { column: columnSuffix, filter, isExclusive }]
    url.searchParams.append(column, filter)
  }

  if (JSON.stringify(updatedFilters) !== JSON.stringify(filters)) {
    newFiltersStateSetter(updatedFilters)
    navigate(`${pathname}${search}`)
  }

  return updatedFilters
}

export const parseFiltersFromUrl = (
  keySuffix: string,
  setFilters: React.Dispatch<React.SetStateAction<IFilter[]>>,
  setParsedFlag: React.Dispatch<React.SetStateAction<boolean>>,
) => {
  try {
    // @ts-expect-error
    const url = new URL(window.location)
    const { searchParams } = url
    const initialFilters: IFilter[] = []

    searchParams.forEach((value, key) => {
      if (!_includes(key, keySuffix)) return

      const keyWithoutSuffix = _replace(key, keySuffix, '')
      if (!isFilterValid(keyWithoutSuffix)) return

      const isExclusive = _startsWith(value, '!')
      initialFilters.push({
        column: keyWithoutSuffix,
        filter: isExclusive ? value.substring(1) : value,
        isExclusive,
      })
    })

    setFilters(initialFilters)
  } catch (error) {
    console.error(`[ERROR] Parsing filters from URL with suffix ${keySuffix}: ${error}`)
  } finally {
    setParsedFlag(true)
  }
}
import { useEffect, useRef, useState } from 'react'
import {
  categories,
  categoryLabels,
  statuses,
  type Company,
} from '../../types/benefits'
import type { QueryState } from '../../lib/benefitsQueryState'
export function BenefitsFilterPanel({
  state,
  update,
  companies,
}: {
  state: QueryState
  update: (patch: Partial<QueryState>) => void
  companies: Company[]
}) {
  const [mobile, setMobile] = useState(
    () => window.matchMedia?.('(max-width: 699px)').matches ?? false,
  )
  const drawer = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 699px)')
    if (!media) return
    const change = (event: MediaQueryListEvent) => setMobile(event.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])
  const close = () => {
    drawer.current?.close()
    trigger.current?.focus()
  }
  const content = (
    <div className="benefits-filter-content">
      <label>
        기업 검색
        <input
          type="search"
          value={state.q}
          maxLength={100}
          onChange={(e) => update({ q: e.target.value, page: 1 })}
        />
      </label>
      <label>
        기업 범위
        <select
          value={state.scope}
          onChange={(e) =>
            update({ scope: e.target.value as QueryState['scope'], page: 1 })
          }
        >
          <option value="all">전체 기업</option>
          <option value="domestic">국내</option>
          <option value="international">해외</option>
        </select>
      </label>
      {(
        [
          ['industry', '업종'],
          ['country', '국가'],
          ['scale', '규모 구간'],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          {label}
          <select
            value={state[key]}
            onChange={(e) => update({ [key]: e.target.value, page: 1 })}
          >
            <option value="">전체</option>
            {[
              ...new Set(
                companies.map((c) =>
                  key === 'country'
                    ? c.headquarters_country
                    : key === 'scale'
                      ? c.scale_band
                      : c.industry,
                ),
              ),
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      ))}
      <fieldset>
        <legend>복지 분야</legend>
        {categories.map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              aria-label={`분야 ${categoryLabels[c]}`}
              checked={state.categories.includes(c)}
              onChange={(e) =>
                update({
                  categories: e.target.checked
                    ? [...state.categories, c]
                    : state.categories.filter((v) => v !== c),
                  page: 1,
                })
              }
            />
            {categoryLabels[c]}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>판정 상태</legend>
        {statuses.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              aria-label={`상태 ${s}`}
              checked={state.statuses.includes(s)}
              onChange={(e) =>
                update({
                  statuses: e.target.checked
                    ? [...state.statuses, s]
                    : state.statuses.filter((v) => v !== s),
                  page: 1,
                })
              }
            />
            {s}
          </label>
        ))}
      </fieldset>
      <button
        onClick={() =>
          update({
            scope: 'all',
            q: '',
            categories: [],
            statuses: [],
            industry: '',
            country: '',
            scale: '',
            page: 1,
          })
        }
      >
        필터 초기화
      </button>
    </div>
  )
  return mobile ? (
    <div>
      <button ref={trigger} onClick={() => drawer.current?.showModal()}>
        필터 열기
      </button>
      <dialog
        ref={drawer}
        className="benefits-filter-drawer"
        aria-label="검색·필터"
        onCancel={(e) => {
          e.preventDefault()
          close()
        }}
      >
        <button onClick={close}>필터 닫기</button>
        <h2>검색·필터</h2>
        {content}
      </dialog>
    </div>
  ) : (
    <details className="benefits-filters" open>
      <summary>검색·필터</summary>
      {content}
    </details>
  )
}

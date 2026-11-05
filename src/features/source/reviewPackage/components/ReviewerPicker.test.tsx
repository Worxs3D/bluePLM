// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { t } from '@/lib/i18n'
import type { TeamWithMembers } from '@/lib/supabase/reviewTeams'
import type { OrgUser } from '@/types/database'

import { ReviewerPicker } from './ReviewerPicker'

const user = (id: string, full_name: string): OrgUser => ({
  id,
  full_name,
  email: `${id}@x.io`,
  avatar_url: null,
})
const users = [user('ann', 'Ann Archer'), user('bob', 'Bob Brown')]
const design: TeamWithMembers = {
  id: 't-design',
  name: 'Design',
  color: '#888',
  icon: 'users',
  description: null,
  members: [
    { id: 'ann', email: 'ann@x.io', full_name: 'Ann Archer', avatar_url: null },
    { id: 'bob', email: 'bob@x.io', full_name: 'Bob Brown', avatar_url: null },
  ],
  reviewerConfigs: [],
}

function renderPicker(reviewerIds: string[] = []) {
  const onToggleReviewer = vi.fn()
  render(
    <ReviewerPicker
      users={users}
      teams={[design]}
      loading={false}
      error={null}
      onRetry={() => {}}
      requesterId="me"
      reviewerIds={reviewerIds}
      teamIds={[]}
      onToggleReviewer={onToggleReviewer}
      onToggleTeam={() => {}}
      noVaultAccessIds={new Set(['bob'])}
    />,
  )
  fireEvent.focus(screen.getByRole('combobox'))
  return { onToggleReviewer }
}

const option = (name: string) =>
  screen.getAllByRole('option').find((el) => (el.textContent ?? '').includes(name))!

afterEach(() => cleanup())

describe('ReviewerPicker and vault access', () => {
  it('shows a person who cannot see the files’ vault as unavailable, with the reason', () => {
    const { onToggleReviewer } = renderPicker()
    const bob = option('Bob Brown')
    expect(bob.getAttribute('aria-disabled')).toBe('true')
    expect(bob.textContent).toContain(t('reviewBuilder.reviewers.noVaultAccess'))
    fireEvent.click(bob)
    expect(onToggleReviewer).not.toHaveBeenCalled()

    const ann = option('Ann Archer')
    expect(ann.getAttribute('aria-disabled')).toBeNull()
    fireEvent.click(ann)
    expect(onToggleReviewer).toHaveBeenCalledWith('ann')
  })

  it('says how many of a team will be skipped', () => {
    renderPicker()
    expect(option('Design').textContent).toContain(
      t('reviewBuilder.reviewers.teamNoVaultAccess', { count: 1 }),
    )
  })

  it('warns on an added person who cannot see it, and still lets them be removed', () => {
    const { onToggleReviewer } = renderPicker(['bob'])
    expect(document.body.textContent).toContain(t('reviewBuilder.reviewers.noVaultAccessAdded'))
    fireEvent.click(option('Bob Brown'))
    expect(onToggleReviewer).toHaveBeenCalledWith('bob')
  })
})

import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

// Scaffolding smoke test: proves the Vitest + jsdom + jest-dom toolchain is wired.
// Real component tests replace this from Phase 3 onward.
test('test harness renders into jsdom', () => {
  render(<h1>Loskai</h1>)
  expect(screen.getByRole('heading', { name: 'Loskai' })).toBeInTheDocument()
})

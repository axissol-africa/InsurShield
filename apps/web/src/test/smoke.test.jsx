import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'

function Counter() {
  const [n, setN] = useState(0)
  return <button onClick={() => setN(n + 1)}>Clicked {n}</button>
}

test('testing-library + user-event + jest-dom are wired up', async () => {
  render(<Counter />)
  const btn = screen.getByRole('button', { name: /clicked 0/i })
  expect(btn).toBeInTheDocument()
  await userEvent.click(btn)
  expect(btn).toHaveTextContent('Clicked 1')
})

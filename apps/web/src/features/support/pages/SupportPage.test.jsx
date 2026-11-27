import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import SupportPage from './SupportPage';

function Destination() {
  const location = useLocation();
  return <p>{location.pathname}{location.search}</p>;
}

it.each([['File claim', 'claim'], ['Apply NCD', 'ncd']])('opens the matching introduction from %s', async (label, action) => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={['/support']}><Routes>
    <Route path="/support" element={<SupportPage />} />
    <Route path="/claims" element={<Destination />} />
  </Routes></MemoryRouter>);
  await user.click(screen.getByRole('button', { name: label }));
  expect(screen.getByText(`/claims?action=${action}`)).toBeInTheDocument();
});

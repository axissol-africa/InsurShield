import { render, screen } from '@testing-library/react';
import JourneyProgress from './JourneyProgress';
import { JOURNEY_COMPLETE } from '../journeySteps';

it('identifies the current step without offering links that bypass required inputs', () => {
  render(<JourneyProgress current={3} />);
  const step = screen.getByRole('list').querySelector('[aria-current="step"]');
  expect(step).toHaveTextContent('Vehicle use');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeCloseTo(33.33, 2);
});

it('marks all steps complete only on the completion screen', () => {
  render(<JourneyProgress current={JOURNEY_COMPLETE} />);
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Journey complete');
  expect(screen.getByRole('list').querySelector('[aria-current="step"]')).toBeNull();
});

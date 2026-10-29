import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverGuideDocument from './CoverGuideDocument';

const answerTo = (label) => screen.getByText(label).nextElementSibling;

describe('CoverGuideDocument', () => {
  it('writes an unanswered period as not stated', () => {
    render(<CoverGuideDocument guide={{ planName: 'Comprehensive Gold Plan', quoteValidityDays: '7' }} coverType="Comprehensive" />);

    expect(answerTo('Notify the insurer within')).toHaveTextContent(/^Not stated$/);
    expect(answerTo('Quote valid for')).toHaveTextContent(/^7 days$/);
  });

  it('writes an answer that is only blank space as not stated', () => {
    render(<CoverGuideDocument guide={{ planName: 'Comprehensive Gold Plan', claimsContact: [' '], notifyWithinDays: [' '] }} coverType="Comprehensive" />);

    expect(answerTo('Claims contact')).toHaveTextContent(/^Not stated$/);
    expect(answerTo('Notify the insurer within')).toHaveTextContent(/^Not stated$/);
  });
});

import { checkProductRequirements, requirementFromStored, requirementSignature, validateQuestionAnswer } from './product-requirements.js';

describe('product requirement definitions', () => {
  const declaration = {
    key: 'truth_declaration',
    kind: 'DECLARATION',
    label: 'Confirm the information is correct',
    required: true,
    config: { text: 'I confirm the information is correct.' },
    displayOrder: 2,
  };

  it('normalises valid typed definitions and rejects malformed insurer configuration', () => {
    const accepted = checkProductRequirements([
      {
        key: 'driver_age',
        kind: 'QUESTION',
        label: 'Main driver age',
        required: true,
        config: { inputType: 'NUMBER' },
        displayOrder: 1,
      },
      declaration,
    ]);

    expect(accepted.errors).toEqual({});
    expect(accepted.requirements).toEqual([
      expect.objectContaining({ key: 'driver_age', config: { inputType: 'NUMBER' }, required: true }),
      expect.objectContaining({ key: 'truth_declaration', config: declaration.config }),
    ]);

    const rejected = checkProductRequirements([
      {
        key: 'driver_age',
        kind: 'QUESTION',
        label: 'Main driver age',
        config: { inputType: 'SELECT', options: [] },
      },
    ]);
    expect(rejected.requirements).toEqual([]);
    expect(rejected.errors).toMatchObject({ 'requirements.0.config': expect.any(String) });
  });

  it('only accepts values that match the product version question type', () => {
    const number = requirementFromStored({
      productVersionId: 'e5b39545-2181-48d3-a604-da0f4edbbb3a',
      key: 'driver_age',
      kind: 'QUESTION',
      label: 'Main driver age',
      helpText: null,
      required: true,
      config: { inputType: 'NUMBER' },
      displayOrder: 0,
    });
    const select = requirementFromStored({
      productVersionId: 'e5b39545-2181-48d3-a604-da0f4edbbb3a',
      key: 'parking',
      kind: 'QUESTION',
      label: 'Where is the vehicle parked?',
      helpText: null,
      required: true,
      config: { inputType: 'SELECT', options: ['Garage', 'Street'] },
      displayOrder: 1,
    });

    expect(number).not.toBeNull();
    expect(select).not.toBeNull();
    expect(validateQuestionAnswer(number!, '32')).toBe(32);
    expect(validateQuestionAnswer(number!, 'thirty two')).toBeNull();
    expect(validateQuestionAnswer(select!, 'Garage')).toBe('Garage');
    expect(validateQuestionAnswer(select!, 'Driveway')).toBeNull();
  });

  it('only allows unscoped sharing when every requirement definition is identical', () => {
    const base = requirementFromStored({
      productVersionId: 'e5b39545-2181-48d3-a604-da0f4edbbb3a',
      key: 'driver_age',
      kind: 'QUESTION',
      label: 'Main driver age',
      helpText: null,
      required: true,
      config: { inputType: 'NUMBER' },
      displayOrder: 0,
    });
    const differentLabel = requirementFromStored({
      productVersionId: '7a9cde1a-d12c-4198-97d4-c827b6076f9a',
      key: 'driver_age',
      kind: 'QUESTION',
      label: 'Age of the main driver',
      helpText: null,
      required: true,
      config: { inputType: 'NUMBER' },
      displayOrder: 0,
    });

    expect(base).not.toBeNull();
    expect(differentLabel).not.toBeNull();
    expect(requirementSignature(base!)).not.toBe(requirementSignature(differentLabel!));
  });
});

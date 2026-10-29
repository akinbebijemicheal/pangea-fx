import { ValidateBy, type ValidationOptions } from 'class-validator';

/** Fails when the value equals another property of the same object. */
export function DiffersFrom(property: string, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'differsFrom',
      constraints: [property],
      validator: {
        validate: (value: unknown, args) =>
          value !== (args?.object as Record<string, unknown>)[property],
        defaultMessage: (args) => `${args?.property} must differ from ${property}`,
      },
    },
    options,
  );
}

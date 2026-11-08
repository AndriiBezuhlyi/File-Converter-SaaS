import { ValidateBy } from 'class-validator';
import { newPasswordIssue } from './new-password-policy.js';

export function NewPassword(): PropertyDecorator {
  return (target, property) => {
    ValidateBy({
      name: 'newPasswordLength',
      validator: {
        validate: (value: unknown) => newPasswordIssue(value) !== 'length',
        defaultMessage: () => 'Use 10–128 Unicode code points.',
      },
    })(target, property);
    ValidateBy({
      name: 'commonPassword',
      validator: {
        validate: (value: unknown) => newPasswordIssue(value) !== 'common',
        defaultMessage: () => 'Avoid common or predictable passwords.',
      },
    })(target, property);
  };
}

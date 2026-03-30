import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SuperDashboard from './SuperDashboard';

describe('SuperDashboard', () => {
    test('renders toolbar and invokes handlers', () => {
        const onBrowseReposParent = jest.fn();
        const onAddRepoFolder = jest.fn();
        render(
            <SuperDashboard
                projectMetrics={{}}
                knownClonePaths={['/a/One', '/b/Two']}
                onBrowseReposParent={onBrowseReposParent}
                onAddRepoFolder={onAddRepoFolder}
                busy={false}
            />
        );
        expect(screen.getByText(/2 repo folders registered/i)).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole('button', { name: /browse for folder containing all cloned repositories/i })
        );
        fireEvent.click(screen.getByRole('button', { name: /add one repository folder/i }));
        expect(onBrowseReposParent).toHaveBeenCalled();
        expect(onAddRepoFolder).toHaveBeenCalled();
    });

    test('disables buttons when busy', () => {
        render(
            <SuperDashboard
                knownClonePaths={[]}
                onBrowseReposParent={jest.fn()}
                onAddRepoFolder={jest.fn()}
                busy
            />
        );
        expect(
            screen.getByRole('button', { name: /browse for folder containing all cloned repositories/i })
        ).toBeDisabled();
        expect(screen.getByRole('button', { name: /add one repository folder/i })).toBeDisabled();
    });

    test('omits toolbar when handlers are not provided', () => {
        render(<SuperDashboard projectMetrics={{}} knownClonePaths={[]} />);
        expect(
            screen.queryByRole('button', { name: /browse for folder containing all cloned repositories/i })
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /add one repository folder/i })).not.toBeInTheDocument();
    });
});

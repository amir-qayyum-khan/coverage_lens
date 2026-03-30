import { waitFor } from '@testing-library/react';
import {
    loadKnownClonePaths,
    rememberClonePath,
    syncKnownClonePathsToLocalStorage
} from './superDashboardClonePaths';

describe('superDashboardClonePaths', () => {
    beforeEach(() => {
        localStorage.clear();
        window.electronAPI = {
            rememberSuperDashboardClone: jest.fn().mockResolvedValue({ success: true })
        };
    });

    test('loadKnownClonePaths returns empty when unset', () => {
        expect(loadKnownClonePaths()).toEqual([]);
    });

    test('rememberClonePath dedupes and persists', async () => {
        rememberClonePath('/a/MyRepo');
        rememberClonePath('/a/MyRepo');
        rememberClonePath('/b/Other');
        expect(loadKnownClonePaths()).toEqual(['/a/MyRepo', '/b/Other']);
        await waitFor(() => {
            expect(window.electronAPI.rememberSuperDashboardClone).toHaveBeenCalledTimes(2);
        });
        expect(window.electronAPI.rememberSuperDashboardClone).toHaveBeenCalledWith('/a/MyRepo');
        expect(window.electronAPI.rememberSuperDashboardClone).toHaveBeenCalledWith('/b/Other');
    });

    test('loadKnownClonePaths filters invalid entries', () => {
        localStorage.setItem('super_dashboard_known_clone_paths', JSON.stringify(['', '  ', 12, '/ok']));
        expect(loadKnownClonePaths()).toEqual(['/ok']);
    });

    test('syncKnownClonePathsToLocalStorage writes deduped paths', () => {
        syncKnownClonePathsToLocalStorage([' /x ', '/x', '/y']);
        expect(loadKnownClonePaths()).toEqual(['/x', '/y']);
    });
});

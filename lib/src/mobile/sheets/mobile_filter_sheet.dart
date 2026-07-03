import 'package:flutter/widgets.dart';

import '../../i18n/locale_provider.dart';
import '../../models/download_controller.dart';
import '../../models/download_task.dart';
import '../mobile_ui.dart';

/// 筛选面板（≈ 桌面侧边栏：文件类型 + 队列）
Future<void> showMobileFilterSheet(
  BuildContext context,
  DownloadController controller,
) {
  return showMobileSheet<void>(
    context,
    builder: (ctx) {
      final s = LocaleScope.of(ctx);
      return MobileSheetContainer(
        title: s.mobileFilterTasks,
        child: ListenableBuilder(
          listenable: controller,
          builder: (ctx, _) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                MobileFieldLabel(s.mobileFileType),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final cat in FileCategory.values)
                      MobileChip(
                        label: cat == FileCategory.all
                            ? s.tabAll
                            : cat.label,
                        selected:
                            controller.customCategoryFilter == null &&
                            controller.categoryFilter == cat,
                        onTap: () => controller.setCategoryFilter(cat),
                      ),
                  ],
                ),
                MobileFieldLabel(s.mobileByQueue),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    MobileChip(
                      label: s.tabAll,
                      selected: controller.queueFilter == null,
                      onTap: () {
                        if (controller.queueFilter != null) {
                          controller.setQueueFilter(null);
                        }
                      },
                    ),
                    MobileChip(
                      label: s.defaultQueue,
                      selected: controller.queueFilter == '',
                      onTap: () {
                        if (controller.queueFilter != '') {
                          controller.setQueueFilter('');
                        }
                      },
                    ),
                    for (final q in controller.queues)
                      MobileChip(
                        label: q.name,
                        selected: controller.queueFilter == q.queueId,
                        onTap: () {
                          if (controller.queueFilter != q.queueId) {
                            controller.setQueueFilter(q.queueId);
                          }
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                MobilePrimaryButton(
                  label: s.mobileResetFilter,
                  filled: false,
                  onTap: () {
                    controller.setCategoryFilter(FileCategory.all);
                    if (controller.queueFilter != null) {
                      controller.setQueueFilter(null);
                    }
                    Navigator.of(ctx).pop();
                  },
                ),
              ],
            );
          },
        ),
      );
    },
  );
}
